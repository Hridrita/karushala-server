import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();
const app = express();
const port: number = parseInt(process.env.PORT!, 10);

app.use(
  cors({
    origin: process.env.BETTER_AUTH_URL,
    credentials: true,
  }),
);
app.use(express.json());

const uri: string = process.env.MONGODB_URI!;

app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("karushala_db");
    const allCraftCollection = db.collection("All-Craft");
    const reviewsCollection = db.collection("Reviews");

    app.post("/api/crafts", async (req: Request, res: Response) => {
      const craft = req.body;
      const result = await allCraftCollection.insertOne(craft);
      res.json(result);
    });

    app.get("/api/crafts", async (req: Request, res: Response) => {
      const result = await allCraftCollection.find().toArray();
      res.json(result);
    });

    app.get("/api/crafts/my-crafts", async (req: Request, res: Response) => {
      const { email } = req.query;
      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }
      const result = await allCraftCollection
        .find({ sellerEmail: email })
        .toArray();
      res.json(result);
    });

    app.get("/api/crafts/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const result = await allCraftCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!result) {
        return res.status(404).json({ message: "Craft not found" });
      }
      res.json(result);
    });

    app.delete("/api/crafts/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      const result = await allCraftCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    // Get all reviews for a craft
    app.get("/api/crafts/:id/reviews", async (req: Request, res: Response) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const reviews = await reviewsCollection
        .find({ craftId: id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(reviews);
    });

    // Add review to separate collection + sync avg rating on craft
    app.post("/api/crafts/:id/reviews", async (req: Request, res: Response) => {
      const { id } = req.params;
      const { name, email, comment, rating } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      if (!email) {
        return res.status(401).json({ message: "please login first" });
      }
      if (!comment?.trim() || !rating) {
        return res.status(400).json({ message: "Comments and ratings needed." });
      }

      const craft = await allCraftCollection.findOne({ _id: new ObjectId(id) });
      if (!craft) {
        return res.status(404).json({ message: "Craft not found" });
      }

      const review = {
        craftId: id,
        name,
        email,
        comment: comment.trim(),
        rating: Number(rating),
        createdAt: new Date(),
      };

      await reviewsCollection.insertOne(review);

      const reviews = await reviewsCollection.find({ craftId: id }).toArray();
      const avgRating =
        reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await allCraftCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { rating: avgRating } },
      );

      res.json({ message: "Review added", reviews, rating: avgRating });
    });


























    

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.error("Database connection error:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});