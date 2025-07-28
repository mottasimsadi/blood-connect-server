const express = require("express");
const cors = require("cors");

const { MongoClient, ServerApiVersion } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

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
    await client.connect();

    const bloodCollection = client.db("bloodDB").collection("bloodConnect");
    const userCollection = client.db("bloodDB").collection("users");
    const donationRequestCollection = client
      .db("bloodDB")
      .collection("donationRequests");

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

    app.get(
      "/get-users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const users = await userCollection
          .find({ email: { $ne: req.firebaseUser.email } })
          .toArray();
        res.send(users);
      }
    );

    app.patch(
      "/update-role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { email, role } = req.body;
        const result = await userCollection.updateOne(
          { email: email },
          {
            $set: { role },
          }
        );

        res.send(result);
      }
    );

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

      const updatedData = req.body;

      const result = await userCollection.updateOne(
        { email: requestedEmail },
        { $set: updatedData }
      );

      res.send(result);
    });

    // Get the current donor's recent donation requests
    app.get(
      "/donation-requests/my-requests",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const requesterEmail = req.firebaseUser.email;
          const limit = parseInt(req.query.limit) || 0;
          const query = { requesterEmail: requesterEmail };
          const sortOptions = { createdAt: -1 };
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

    // Update the status of a donation request
    app.patch(
      "/donation-requests/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;
          if (!status) {
            return res.status(400).send({ message: "Status is required." });
          }
          const query = { _id: new ObjectId(id) };
          const request = await donationRequestCollection.findOne(query);
          if (!request) {
            return res.status(404).send({ message: "Request not found." });
          }
          if (request.requesterEmail !== req.firebaseUser.email) {
            return res.status(403).send({
              message: "Forbidden: Not authorized to update this request.",
            });
          }
          const updateDoc = { $set: { status: status } };
          const result = await donationRequestCollection.updateOne(
            query,
            updateDoc
          );
          res.send(result);
        } catch (error) {
          console.error("Error updating donation request status:", error);
          res
            .status(500)
            .send({ message: "Failed to update donation request status." });
        }
      }
    );

    // Delete a donation request
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
          if (request.requesterEmail !== req.firebaseUser.email) {
            return res
              .status(403)
              .send({
                message: "Forbidden: Not authorized to delete this request.",
              });
          }
          const result = await donationRequestCollection.deleteOne(query);
          res.send(result);
        } catch (error) {
          console.error("Error deleting donation request:", error);
          res
            .status(500)
            .send({ message: "Failed to delete donation request." });
        }
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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
