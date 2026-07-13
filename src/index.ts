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
    const ordersCollection = db.collection("Orders");

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



    /**
     * GET /api/dashboard
     * Get all dashboard statistics for a specific artisan
     * Query params: email (required)
     */
    app.get("/api/dashboard", async (req: Request, res: Response) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      try {
        // Get all crafts by this artisan
        const crafts = await allCraftCollection
          .find({ sellerEmail: email })
          .toArray();

        const totalCrafts = crafts.length;

        // Get reviews for all artisan's crafts
        const craftIds = crafts.map((c) => c._id.toString());
        const allReviews = await reviewsCollection
          .find({ craftId: { $in: craftIds } })
          .toArray();

        // Calculate review statistics
        const totalReviews = allReviews.length;
        const averageRating = totalReviews > 0
          ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
          : 0;

        // Get sales data (aggregated from orders)
        let salesData = [];
        try {
          // Check if orders collection exists
          const collections = await db.listCollections().toArray();
          const hasOrdersCollection = collections.some(c => c.name === "Orders");

          if (hasOrdersCollection) {
            const salesAggregation = await ordersCollection.aggregate([
              {
                $match: { sellerEmail: email }
              },
              {
                $group: {
                  _id: {
                    month: { $month: "$createdAt" },
                    year: { $year: "$createdAt" }
                  },
                  totalSales: { $sum: "$amount" }
                }
              },
              {
                $sort: { "_id.year": 1, "_id.month": 1 }
              }
            ]).toArray();

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            
            if (salesAggregation.length > 0) {
              salesData = salesAggregation.map((item) => ({
                month: monthNames[item._id.month - 1],
                sales: item.totalSales
              }));
            } else {
              // Generate last 6 months with zero sales
              const currentMonth = new Date().getMonth();
              salesData = Array.from({ length: 6 }, (_, i) => {
                const monthIndex = (currentMonth - 5 + i + 12) % 12;
                return {
                  month: monthNames[monthIndex],
                  sales: 0
                };
              });
            }
          } else {
            // No orders collection yet - return mock data
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
            salesData = monthNames.map((month) => ({
              month,
              sales: 0
            }));
          }
        } catch (error) {
          console.error("Sales data error:", error);
          // Fallback mock data
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
          salesData = monthNames.map((month) => ({
            month,
            sales: 0
          }));
        }

        // Get recent reviews with craft titles
        const recentReviews = await reviewsCollection
          .find({ craftId: { $in: craftIds } })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const reviewsData = await Promise.all(
          recentReviews.map(async (review) => {
            const craft = await allCraftCollection.findOne({
              _id: new ObjectId(review.craftId),
            });
            return {
              name: review.name,
              comment: review.comment,
              rating: review.rating,
              craftTitle: craft?.title || "Unknown",
            };
          })
        );

        // Calculate total sales
        const totalSales = salesData.reduce((sum, item) => sum + item.sales, 0);

        // Return dashboard data
        res.json({
          totalCrafts,
          totalSales,
          totalReviews,
          averageRating,
          recentCrafts: crafts.slice(0, 5).map((c) => ({
            ...c,
            _id: c._id.toString(),
          })),
          salesData,
          reviewsData,
        });
      } catch (error) {
        console.error("Dashboard error:", error);
        res.status(500).json({ message: "Failed to fetch dashboard data" });
      }
    });

    /**
     * GET /api/dashboard/sales
     * Get sales data for a specific artisan (for chart)
     * Query params: email (required)
     */
    app.get("/api/dashboard/sales", async (req: Request, res: Response) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      try {
        // Check if orders collection exists
        const collections = await db.listCollections().toArray();
        const hasOrdersCollection = collections.some(c => c.name === "Orders");

        if (!hasOrdersCollection) {
          // Return mock data
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
          const mockData = monthNames.map((month) => ({
            month,
            sales: 0
          }));
          return res.json(mockData);
        }

        const salesData = await ordersCollection.aggregate([
          {
            $match: { sellerEmail: email }
          },
          {
            $group: {
              _id: {
                month: { $month: "$createdAt" },
                year: { $year: "$createdAt" }
              },
              totalSales: { $sum: "$amount" }
            }
          },
          {
            $sort: { "_id.year": 1, "_id.month": 1 }
          }
        ]).toArray();

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        const formattedData = salesData.map((item) => ({
          month: monthNames[item._id.month - 1],
          sales: item.totalSales
        }));

        res.json(formattedData);
      } catch (error) {
        console.error("Sales data error:", error);
        res.status(500).json({ message: "Failed to fetch sales data" });
      }
    });

    /**
     * GET /api/dashboard/reviews
     * Get all reviews for an artisan's crafts
     * Query params: email (required)
     */
    app.get("/api/dashboard/reviews", async (req: Request, res: Response) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      try {
        // Get all crafts by this artisan
        const crafts = await allCraftCollection
          .find({ sellerEmail: email })
          .toArray();

        const craftIds = crafts.map((c) => c._id.toString());

        // Get all reviews for these crafts
        const reviews = await reviewsCollection
          .find({ craftId: { $in: craftIds } })
          .sort({ createdAt: -1 })
          .toArray();

        // Get craft titles for each review
        const reviewsWithTitles = await Promise.all(
          reviews.map(async (review) => {
            const craft = await allCraftCollection.findOne({
              _id: new ObjectId(review.craftId),
            });
            return {
              ...review,
              craftTitle: craft?.title || "Unknown",
            };
          })
        );

        res.json(reviewsWithTitles);
      } catch (error) {
        console.error("Reviews data error:", error);
        res.status(500).json({ message: "Failed to fetch reviews" });
      }
    });

    /**
     * PUT /api/crafts/:id
     * Update a craft
     * Body: craft data
     */
    app.put("/api/crafts/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      const updates = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      try {
        // Remove _id from updates if present
        delete updates._id;

        const result = await allCraftCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Craft not found" });
        }

        const updatedCraft = await allCraftCollection.findOne({
          _id: new ObjectId(id),
        });

        res.json(updatedCraft);
      } catch (error) {
        console.error("Update error:", error);
        res.status(500).json({ message: "Failed to update craft" });
      }
    });

    /**
     * GET /api/crafts/my-crafts/paginated
     * Get artisan's crafts with pagination
     * Query params: email (required), page, limit
     */
    app.get("/api/crafts/my-crafts/paginated", async (req: Request, res: Response) => {
      const { email, page = "1", limit = "10" } = req.query;

      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      try {
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        const crafts = await allCraftCollection
          .find({ sellerEmail: email })
          .skip(skip)
          .limit(limitNum)
          .sort({ createdAt: -1 })
          .toArray();

        const total = await allCraftCollection.countDocuments({
          sellerEmail: email,
        });

        res.json({
          crafts: crafts.map((c) => ({ ...c, _id: c._id.toString() })),
          total,
          page: pageNum,
          totalPages: Math.ceil(total / limitNum),
        });
      } catch (error) {
        console.error("Paginated crafts error:", error);
        res.status(500).json({ message: "Failed to fetch crafts" });
      }
    });

    /**
     * GET /api/dashboard/stats
     * Get only stats (total crafts, reviews, etc.)
     * Query params: email (required)
     */
    app.get("/api/dashboard/stats", async (req: Request, res: Response) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      try {
        const crafts = await allCraftCollection
          .find({ sellerEmail: email })
          .toArray();

        const totalCrafts = crafts.length;
        const craftIds = crafts.map((c) => c._id.toString());

        const allReviews = await reviewsCollection
          .find({ craftId: { $in: craftIds } })
          .toArray();

        const totalReviews = allReviews.length;
        const averageRating = totalReviews > 0
          ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
          : 0;

        // Calculate total sales
        let totalSales = 0;
        try {
          const collections = await db.listCollections().toArray();
          const hasOrdersCollection = collections.some(c => c.name === "Orders");
          
          if (hasOrdersCollection) {
            const salesResult = await ordersCollection.aggregate([
              { $match: { sellerEmail: email } },
              { $group: { _id: null, total: { $sum: "$amount" } } }
            ]).toArray();
            
            if (salesResult.length > 0) {
              totalSales = salesResult[0].total;
            }
          }
        } catch (error) {
          console.error("Sales calculation error:", error);
        }

        res.json({
          totalCrafts,
          totalSales,
          totalReviews,
          averageRating,
        });
      } catch (error) {
        console.error("Stats error:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
      }
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