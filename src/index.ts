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

    app.delete("/api/crafts/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      const result = await allCraftCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
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
