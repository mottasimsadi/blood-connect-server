# BloodConnect - A Lifesaving Blood Donation Platform (Server Side)

This repository contains the backend server for the BloodConnect application. It is a robust RESTful API built with Node.js, Express.js, and MongoDB, providing all the necessary endpoints for user management, donation requests, content management, payments, and secure, role-based access control.

---

## 🚀 Live API URL

**Base URL:** https://blood-connect-server.vercel.app/

---

### ✨ Key Features

*   **Secure RESTful API:** Provides a complete set of endpoints for all CRUD (Create, Read, Update, Delete) operations.
*   **JWT Authentication & Authorization:** Integrates with Firebase Admin SDK to verify JWTs on all private routes, ensuring secure access to data.
*   **Role-Based Access Control (RBAC):** Implements custom middleware (`verifyAdmin`, `verifyAdminOrVolunteer`) to protect sensitive endpoints, ensuring that only users with the appropriate roles (admin, volunteer) can perform specific actions.
*   **Dynamic Data Filtering:** API endpoints support dynamic filtering (e.g., by status) and limiting results for features like pagination and dashboard summaries.
*   **Stripe Payment Integration:** Includes a dedicated endpoint for creating Stripe Payment Intents, enabling secure and reliable online donations.
*   **Advanced Data Aggregation:** Utilizes MongoDB's aggregation pipeline to provide comprehensive statistics for the admin dashboard, including monthly donation trends, request status breakdowns, blood type distribution, and funding totals.
*   **Robust Security Measures:** Designed with security in mind, such as preventing users from modifying others' data, validating ObjectIDs to prevent crashes, and ensuring admins cannot be managed through the public user list.

---

### 🛠️ Technology Stack

*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **Database:** MongoDB (with MongoDB Native Driver)
*   **Authentication:** Firebase Admin SDK (for JWT verification)
*   **Payment Gateway:** Stripe
*   **Environment Management:** Dotenv
*   **CORS:** `cors` middleware

---

### API Endpoints

Here is a summary of the primary API endpoints available:

#### Public Routes
*   `GET /search-donors`: Searches for active donors based on query params (`bloodGroup`, `district`, `upazila`).
*   `GET /donation-requests/pending`: Fetches all donation requests with a `pending` status.
*   `GET /blogs/published`: Fetches all blog posts with a `published` status.
*   `GET /blogs/public/:id`: Fetches a single published blog post for public viewing.

#### Authenticated Routes
*   `POST /add-user`: Creates a new user in the database or updates login info.
*   `GET /users/:email`: Fetches a user's full profile (protected).
*   `PATCH /users/:email`: Allows a user to update their own profile.
*   `POST /donation-requests`: Allows an active user to create a new donation request.
*   `GET /donation-requests/my-requests`: Fetches all requests created by the currently logged-in user.
*   `POST /create-payment-intent`: Creates a Stripe payment intent.
*   `POST /funding`: Saves a successful donation record to the database.
*   `GET /funding`: Fetches the history of all funding donations.

#### Admin & Volunteer Routes
*   `GET /admin-stats`: (`admin`, `volunteer`) - Fetches basic platform-wide statistics (total users, funds, requests).
*   `GET /donation-requests`: (`admin`, `volunteer`) - Fetches all donation requests with filtering.
*   `GET /blogs`: (`admin`, `volunteer`) - Fetches all blogs with filtering.
*   `POST /blogs`: (`admin`, `volunteer`) - Creates a new blog post as a draft.

#### Admin-Only Routes
*   `GET /dashboard-stats`: Fetches a comprehensive set of aggregated data for all charts on the admin statistics page.
*   `GET /get-users`: Fetches all users with status filtering.
*   `PATCH /update-users/status/:id`: Updates a user's status (active/blocked).
*   `PATCH /update-users/role/:id`: Updates a user's role (donor/volunteer/admin).
*   `PATCH /blogs/status/:id`: Updates a blog's status (draft/published).
*   `DELETE /blogs/:id`: Deletes a blog post.

---

### 🚀 Getting Started

To run this server locally, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/mottasimsadi/blood-connect-server
    cd blood-connect-server
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root directory and add your MongoDB and Stripe secret keys:
    ```
    MONGODB_URI=your_mongodb_connection_string
    STRIPE_SECRET_KEY=your_stripe_secret_key
    ```

4.  **Add Firebase Admin Credentials:**
    *   Go to your Firebase project settings -> Service accounts.
    *   Click "Generate new private key" to download a JSON file.
    *   Rename this file to `admin-key.json` and place it in the root directory of the server project.

5.  **Run the server:**
    ```bash
    npm start
    ```

The API server should now be running on `http://localhost:3000`.
