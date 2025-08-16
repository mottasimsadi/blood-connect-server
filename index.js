const express = require("express");
const cors = require("cors");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");

const serviceAccount = require("./admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// middleware/auth.js

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decodedToken; // You can access user info like uid, email, etc.
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid token from catch" });
  }
};

async function run() {
  try {
    // Connect the client to the server
    // await client.connect();

    const userCollection = client.db("bloodDB").collection("users");
    const donationRequestCollection = client
      .db("bloodDB")
      .collection("donationRequests");
    const blogCollection = client.db("bloodDB").collection("blogs");
    const fundingCollection = client.db("bloodDB").collection("funding");

    const verifyAdmin = async (req, res, next) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });

      if (user.role === "admin") {
        next();
      } else {
        res.status(403).send({ msg: "unauthorized" });
      }
    };

    // New middleware to allow admins and volunteers
    const verifyAdminOrVolunteer = async (req, res, next) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });
      if (user?.role === "admin" || user?.role === "volunteer") {
        next();
      } else {
        res.status(403).send({ msg: "unauthorized" });
      }
    };

    // Public Routes

    // GET to search for available donors
    app.get("/search-donors", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;

        const query = {
          status: "active",
          role: "donor",
        };

        if (bloodGroup) {
          query.bloodGroup = bloodGroup;
        }
        if (district) {
          query.district = district;
        }
        if (upazila) {
          query.upazila = upazila;
        }

        const donors = await userCollection
          .find(query)
          .project({
            name: 1,
            email: 1,
            bloodGroup: 1,
            district: 1,
            upazila: 1,
            photoURL: 1,
          })
          .toArray();

        res.send(donors);
      } catch (error) {
        console.error("Error searching for donors:", error);
        res
          .status(500)
          .send({ message: "An error occurred while searching for donors." });
      }
    });

    // GET all Pending donation requests for the public page
    app.get("/donation-requests/pending", async (req, res) => {
      try {
        const query = { status: "pending" };

        const pendingRequests = await donationRequestCollection
          .find(query)
          .project({
            recipientName: 1,
            recipientDistrict: 1,
            recipientUpazila: 1,
            bloodGroup: 1,
            donationDate: 1,
            donationTime: 1,
          })
          .toArray();

        res.send(pendingRequests);
      } catch (error) {
        console.error("Error fetching pending donation requests:", error);
        res
          .status(500)
          .send({ message: "An error occurred while fetching requests." });
      }
    });

    // Admin Routes

    // GET admin statistics for the dashboard
    app.get(
      "/admin-stats",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const totalUsers = await userCollection.countDocuments();
          const totalRequests =
            await donationRequestCollection.countDocuments();

          const fundingPipeline = [
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ];
          const fundingResult = await fundingCollection
            .aggregate(fundingPipeline)
            .toArray();
          const totalFunding =
            fundingResult.length > 0 ? fundingResult[0].total : 0;

          res.send({ totalUsers, totalFunding, totalRequests });
        } catch (error) {
          console.error("Error fetching admin stats:", error);
          res
            .status(500)
            .send({ message: "Failed to fetch admin statistics." });
        }
      }
    );

    // GET all users with optional status filtering
    app.get(
      "/get-users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const status = req.query.status;
          const query = { email: { $ne: req.firebaseUser.email } };

          if (status && status !== "all") {
            query.status = status;
          }
          const users = await userCollection.find(query).toArray();
          res.send(users);
        } catch (error) {
          console.error("Error fetching all users:", error);
          res.status(500).send({ message: "Failed to fetch users." });
        }
      }
    );

    // PATCH to update a user's status (block/unblock)
    app.patch(
      "/update-users/status/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;
          if (!status || !["active", "blocked"].includes(status)) {
            return res
              .status(400)
              .send({ message: "Invalid status provided." });
          }
          const query = { _id: new ObjectId(id) };
          const updateDoc = { $set: { status: status } };
          const result = await userCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error updating user status:", error);
          res.status(500).send({ message: "Failed to update user status." });
        }
      }
    );

    // PATCH to update a user's role
    app.patch(
      "/update-users/role/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { role } = req.body;
          if (!role || !["donor", "volunteer", "admin"].includes(role)) {
            return res.status(400).send({ message: "Invalid role provided." });
          }
          const query = { _id: new ObjectId(id) };
          const updateDoc = { $set: { role: role } };
          const result = await userCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error updating user role:", error);
          res.status(500).send({ message: "Failed to update user role." });
        }
      }
    );

    // User Management Routes

    app.post("/add-user", async (req, res) => {
      const userData = req.body;

      if (!userData || !userData.email) {
        return res.status(400).json({ message: "Invalid user data provided." });
      }

      try {
        const find_result = await userCollection.findOne({
          email: userData.email,
        });

        if (find_result) {
          const dataToUpdate = {};
          if (userData.name) dataToUpdate.name = userData.name;
          if (userData.photoURL) dataToUpdate.photoURL = userData.photoURL;

          if (Object.keys(dataToUpdate).length > 0) {
            await userCollection.updateOne(
              { email: userData.email },
              {
                $set: dataToUpdate,
                $inc: { loginCount: 1 },
              }
            );
          } else {
            // If no new data, just increment the login count
            await userCollection.updateOne(
              { email: userData.email },
              { $inc: { loginCount: 1 } }
            );
          }

          res.send({ msg: "User already exists and was updated." });
        } else {
          // New user, insert the full document
          const newUser = {
            ...userData,
            phoneNumber: userData.phoneNumber || "",
            status: "active",
            loginCount: 1,
          };
          const result = await userCollection.insertOne(newUser);
          res.send(result);
        }
      } catch (error) {
        console.error("ERROR in /add-user endpoint:", error);
        res.status(500).json({
          message: "An error occurred on the server while processing the user.",
        });
      }
    });

    app.get("/get-user-role", verifyFirebaseToken, async (req, res) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });
      res.send({ msg: "ok", role: user.role, status: "active" });
    });

    // GET a single user's full profile by email
    app.get("/users/:email", verifyFirebaseToken, async (req, res) => {
      // Ensure a user can only request their own data, unless they are an admin
      const requestedEmail = req.params.email;
      if (req.firebaseUser.email !== requestedEmail) {
        // Optional: Check if the requester is an admin to allow them access
        const requester = await userCollection.findOne({
          email: req.firebaseUser.email,
        });
        if (requester?.role !== "admin") {
          return res.status(403).send({
            message: "Forbidden: You can only access your own profile.",
          });
        }
      }

      const user = await userCollection.findOne({ email: requestedEmail });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send(user);
    });

    // PATCH (update) a user's profile
    app.patch("/users/:email", verifyFirebaseToken, async (req, res) => {
      const requestedEmail = req.params.email;
      if (req.firebaseUser.email !== requestedEmail) {
        return res.status(403).send({
          message: "Forbidden: You can only update your own profile.",
        });
      }

      const { name, photoURL, bloodGroup, district, upazila, phoneNumber } =
        req.body;
      const updatedData = {
        name,
        photoURL,
        bloodGroup,
        district,
        upazila,
        phoneNumber,
      };

      const result = await userCollection.updateOne(
        { email: requestedEmail },
        { $set: updatedData }
      );

      res.send(result);
    });

    // Dontaion Request Routes

    // Get ALL donation requests (for Admin and Volunteer), with filtering
    app.get(
      "/donation-requests",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const status = req.query.status;
          const query = {};
          if (status && status !== "all") {
            query.status = status;
          }
          const sortOptions = { createdAt: -1 };
          const requests = await donationRequestCollection
            .find(query)
            .sort(sortOptions)
            .toArray();
          res.send(requests);
        } catch (error) {
          console.error("Error fetching all donation requests:", error);
          res.status(500).send({ message: "Failed to fetch requests." });
        }
      }
    );

    // Get the current donor's donation requests with filtering and optional limit
    app.get(
      "/donation-requests/my-requests",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const requesterEmail = req.firebaseUser.email;
          const status = req.query.status;
          const limit = parseInt(req.query.limit) || 0;

          const query = { requesterEmail: requesterEmail };

          if (status && status !== "all") {
            query.status = status;
          }

          const sortOptions = { createdAt: -1 }; // Sort by newest first
          const cursor = donationRequestCollection
            .find(query)
            .sort(sortOptions);

          if (limit > 0) {
            cursor.limit(limit);
          }

          const requests = await cursor.toArray();
          res.send(requests);
        } catch (error) {
          console.error("Error fetching my donation requests:", error);
          res
            .status(500)
            .send({ message: "Failed to fetch donation requests." });
        }
      }
    );

    // Get a single, detailed donation request by its ID
    app.get("/donation-requests/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const request = await donationRequestCollection.findOne(query);

        if (!request) {
          return res.status(404).send({ message: "Request not found." });
        }
        res.send(request);
      } catch (error) {
        console.error("Error fetching single donation request:", error);
        res.status(500).send({ message: "Failed to fetch request." });
      }
    });

    // Confirm a donation (change status to 'inprogress' and add donor info)
    app.patch(
      "/donation-requests/confirm/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { donorName, donorEmail } = req.body;

          const query = { _id: new ObjectId(id) };
          const request = await donationRequestCollection.findOne(query);

          if (!request) {
            return res.status(404).send({ message: "Request not found." });
          }
          if (request.status !== "pending") {
            return res
              .status(400)
              .send({ message: `This request is already ${request.status}.` });
          }
          if (request.requesterEmail === req.firebaseUser.email) {
            return res
              .status(403)
              .send({ message: "You cannot donate to your own request." });
          }

          const updateDoc = {
            $set: {
              status: "inprogress",
              donorName: donorName,
              donorEmail: donorEmail,
            },
          };

          const result = await donationRequestCollection.updateOne(
            query,
            updateDoc
          );
          res.send(result);
        } catch (error) {
          console.error("Error confirming donation:", error);
          res.status(500).send({ message: "Failed to confirm donation." });
        }
      }
    );

    // Update status (Owner, Admin, Or Volunteer can do this)
    app.patch(
      "/donation-requests/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ID format." });
          }

          const updateData = req.body;
          const query = { _id: new ObjectId(id) };

          const request = await donationRequestCollection.findOne(query);
          if (!request) {
            return res.status(404).send({ message: "Request not found." });
          }

          const requester = await userCollection.findOne({
            email: req.firebaseUser.email,
          });

          const isStatusOnlyUpdate =
            Object.keys(updateData).length === 1 && updateData.status;

          if (isStatusOnlyUpdate) {
            if (
              request.requesterEmail !== req.firebaseUser.email &&
              requester?.role !== "admin" &&
              requester?.role !== "volunteer"
            ) {
              return res.status(403).send({
                message: "Forbidden: Not authorized to update status.",
              });
            }
          } else {
            if (
              request.requesterEmail !== req.firebaseUser.email &&
              requester?.role !== "admin"
            ) {
              return res.status(403).send({
                message: "Forbidden: Not authorized to edit this request.",
              });
            }
          }

          const updateDoc = { $set: updateData };
          const result = await donationRequestCollection.updateOne(
            query,
            updateDoc
          );
          res.send(result);
        } catch (error) {
          console.error("Error updating donation request:", error);
          res.status(500).send({ message: "Failed to update request." });
        }
      }
    );

    // Delete request (Owner Or Admin can do this. Volunteer cannot.)
    app.delete(
      "/donation-requests/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const request = await donationRequestCollection.findOne(query);
          if (!request) {
            return res.status(404).send({ message: "Request not found." });
          }

          const requester = await userCollection.findOne({
            email: req.firebaseUser.email,
          });

          if (
            request.requesterEmail !== req.firebaseUser.email &&
            requester?.role !== "admin"
          ) {
            return res.status(403).send({
              message: "Forbidden: Not authorized to delete this request.",
            });
          }

          const result = await donationRequestCollection.deleteOne(query);
          res.send(result);
        } catch (error) {
          console.error("Error deleting donation request:", error);
          res.status(500).send({ message: "Failed to delete request." });
        }
      }
    );

    // POST to create a donation request
    app.post("/donation-requests", verifyFirebaseToken, async (req, res) => {
      try {
        const user = await userCollection.findOne({
          email: req.firebaseUser.email,
        });
        if (user?.status === "blocked") {
          return res.status(403).send({
            message:
              "Access Denied: Blocked users cannot create donation requests.",
          });
        }

        const newRequest = req.body;
        const result = await donationRequestCollection.insertOne(newRequest);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating donation request:", error);
        res.status(500).send({ message: "Failed to create donation request." });
      }
    });

    // Blog Content Management Route (Admin & Volunteer Only)

    // POST a new blog post (Allow both Admins and Volunteers to POST blogs)
    app.post(
      "/blogs",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const newBlog = req.body;
          newBlog.status = "draft";
          newBlog.createdAt = new Date();
          const result = await blogCollection.insertOne(newBlog);
          res.status(201).send(result);
        } catch (error) {
          console.error("Error creating blog post:", error);
          res.status(500).send({ message: "Failed to create blog post." });
        }
      }
    );

    // GET all blog posts with status filtering (Allow both Admins and Volunteers to GET blogs)
    app.get(
      "/blogs",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const status = req.query.status;
          const query = {};
          if (status && status !== "all") {
            query.status = status;
          }
          const sortOptions = { createdAt: -1 }; // Show newest first
          const blogs = await blogCollection
            .find(query)
            .sort(sortOptions)
            .toArray();
          res.send(blogs);
        } catch (error) {
          console.error("Error fetching blogs:", error);
          res.status(500).send({ message: "Failed to fetch blog posts." });
        }
      }
    );
    // GET all Published blog posts for the public blog page
    app.get("/blogs/published", async (req, res) => {
      try {
        const query = { status: "published" };
        const sortOptions = { createdAt: -1 }; // Show newest first

        const blogs = await blogCollection
          .find(query)
          .sort(sortOptions)
          .project({
            title: 1,
            thumbnail: 1,
            createdAt: 1,
          })
          .toArray();

        res.send(blogs);
      } catch (error) {
        console.error("Error fetching published blogs:", error);
        res.status(500).send({ message: "Failed to fetch blogs." });
      }
    });

    // Get a single blog by its ID (for the edit page)
    app.get(
      "/blogs/private/:id",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid blog ID format." });
          }
          const query = { _id: new ObjectId(id) };
          const blog = await blogCollection.findOne(query);
          if (!blog) {
            return res.status(404).send({ message: "Blog not found." });
          }
          res.send(blog);
        } catch (error) {
          console.error("Error fetching single blog:", error);
          res.status(500).send({ message: "Failed to fetch blog post." });
        }
      }
    );

    // GET a single blog post by its ID for the details page
    app.get("/blogs/public/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid blog ID format." });
        }
        const query = { _id: new ObjectId(id) };

        const blog = await blogCollection.findOne(query);

        if (!blog || blog.status !== "published") {
          return res
            .status(404)
            .send({ message: "Blog not found or is not published." });
        }
        res.send(blog);
      } catch (error) {
        console.error("Error fetching single blog post:", error);
        res.status(500).send({ message: "Failed to fetch blog post." });
      }
    });

    // Update a blog post
    app.patch(
      "/blogs/:id",
      verifyFirebaseToken,
      verifyAdminOrVolunteer,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid blog ID format." });
          }
          const updatedData = req.body;
          const query = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: {
              title: updatedData.title,
              thumbnail: updatedData.thumbnail,
              content: updatedData.content,
            },
          };
          const result = await blogCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error updating blog post:", error);
          res.status(500).send({ message: "Failed to update blog post." });
        }
      }
    );

    // PATCH to update a blog's status (publish/unpublish)
    app.patch(
      "/blogs/status/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;
          if (!status || !["draft", "published"].includes(status)) {
            return res
              .status(400)
              .send({ message: "Invalid status provided." });
          }
          const query = { _id: new ObjectId(id) };
          const updateDoc = { $set: { status: status } };
          const result = await blogCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error updating blog status:", error);
          res.status(500).send({ message: "Failed to update blog status." });
        }
      }
    );

    // DELETE a blog post
    app.delete(
      "/blogs/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const result = await blogCollection.deleteOne(query);
          res.send(result);
        } catch (error) {
          console.error("Error deleting blog post:", error);
          res.status(500).send({ message: "Failed to delete blog post." });
        }
      }
    );

    // Funding & Payment Routes

    // POST to create a Stripe Payment Intent
    app.post(
      "/create-payment-intent",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { price } = req.body;
          const amountInCents = Math.round(parseFloat(price) * 100);

          if (isNaN(amountInCents) || amountInCents < 50) {
            // Stripe minimum is $0.50
            return res.status(400).send({ message: "Invalid amount." });
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "usd",
            payment_method_types: ["card"],
          });
          res.send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          console.error("Error creating payment intent:", error);
          res.status(500).send({ message: "Failed to create payment intent." });
        }
      }
    );

    // POST to save a successful funding transaction to the database
    app.post("/funding", verifyFirebaseToken, async (req, res) => {
      try {
        const paymentInfo = req.body;
        paymentInfo.date = new Date(paymentInfo.date);
        const result = await fundingCollection.insertOne(paymentInfo);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error saving funding info:", error);
        res.status(500).send({ message: "Failed to save donation." });
      }
    });

    // GET all funding transactions for the table view
    app.get("/funding", verifyFirebaseToken, async (req, res) => {
      try {
        const sortOptions = { date: -1 }; // Show newest first
        const funds = await fundingCollection
          .find({})
          .sort(sortOptions)
          .toArray();
        res.send(funds);
      } catch (error) {
        console.error("Error fetching funding data:", error);
        res.status(500).send({ message: "Failed to fetch funding data." });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run().catch(console.dir);

// Root route
app.get("/", async (req, res) => {
  res.send("Blood Connect is running perfectly!");
});

app.listen(PORT, () => {
  console.log(`Blood Connect server is running on port ${PORT}`);
});
