import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";


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

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`)
)

const verifyToken = async(req: Request,res: Response,next:NextFunction):Promise<void> =>{
  const authHeader = req.headers.authorization
  if(!authHeader){
   res.status(401).json({message: "Unauthorized"})
   return;
  }
  // console.log(authHeader);
  const token = authHeader.split(" ")[1]
  if(!token){
     res.status(401).json({message: "Unauthorized"});
     return
  }

  try{
    const {payload} = await jwtVerify(token,JWKS)
  // console.log(payload);
  next()
  } catch(error) {
    res.status(403).json({message: "Fprbidden"})
    return;
  }
  
  

}



const DEMO_EMAILS = ["demo@karushala.com", "demo@example.com", "test@karushala.com"];

const isDemoUser = (email: string): boolean => {
  if (!email) return false;
  return DEMO_EMAILS.includes(email.toLowerCase());
};

// Middleware for restricting demo users
const restrictDemoUser = (req: Request, res: Response, next: Function) => {
  // Get email from body, query, or headers
  const email = req.body?.email || req.query?.email || req.headers['x-user-email'];
  
  if (isDemoUser(email)) {
    return res.status(403).json({
      success: false,
      message: "Demo users cannot perform this action. Please create your own account.",
      code: "DEMO_RESTRICTED"
    });
  }
  
  next();
};

async function run() {
  try {
    await client.connect();

    const db = client.db("karushala_db");
    const allCraftCollection = db.collection("All-Craft");
    const reviewsCollection = db.collection("Reviews");
    const ordersCollection = db.collection("Orders");
    const usersCollection = db.collection("user");

    app.post("/api/crafts",restrictDemoUser,verifyToken, async (req: Request, res: Response) => {
      const craft = req.body;
      const result = await allCraftCollection.insertOne(craft);
      res.json(result);
    });

    app.get("/api/crafts", async (req: Request, res: Response) => {
      const result = await allCraftCollection.find().toArray();
      res.json(result);
    });

    app.get("/api/crafts/my-crafts",verifyToken, async (req: Request, res: Response) => {
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

    app.delete("/api/crafts/:id",restrictDemoUser, async (req: Request, res: Response) => {
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
    app.post("/api/crafts/:id/reviews",verifyToken, async (req: Request, res: Response) => {
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



    
    app.get("/api/dashboard",verifyToken, async (req: Request, res: Response) => {
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

    
    app.get("/api/dashboard/sales",verifyToken, async (req: Request, res: Response) => {
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

    
    app.put("/api/crafts/:id",restrictDemoUser, async (req: Request, res: Response) => {
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

    
    app.get("/api/crafts/my-crafts/paginated",verifyToken, async (req: Request, res: Response) => {
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

    
    app.get("/api/dashboard/stats",verifyToken, async (req: Request, res: Response) => {
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




    
app.get("/api/profile",verifyToken, async (req: Request, res: Response) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  try {
    // Get user from better-auth users collection
    const usersCollection = db.collection("user");
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's crafts count
    const craftsCount = await allCraftCollection.countDocuments({
      sellerEmail: email,
    });

    // Get user's crafts for review calculation
    const crafts = await allCraftCollection
      .find({ sellerEmail: email })
      .toArray();
    const craftIds = crafts.map((c) => c._id.toString());

    // Get reviews for user's crafts
    const reviews = await reviewsCollection
      .find({ craftId: { $in: craftIds } })
      .toArray();

    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    // Calculate total sales (if orders collection exists)
    let totalSales = 0;
    try {
      const collections = await db.listCollections().toArray();
      const hasOrdersCollection = collections.some(c => c.name === "Orders");

      if (hasOrdersCollection) {
        const salesResult = await ordersCollection.aggregate([
          { $match: { sellerEmail: email } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray();

        if (salesResult.length > 0) {
          totalSales = salesResult[0].total;
        }
      }
    } catch (error) {
      console.error("Sales calculation error:", error);
    }

    // Return profile data
    res.json({
      _id: user._id,
      name: user.name || "",
      email: user.email,
      phone: user.phone || "",
      address: user.address || "",
      city: user.city || "",
      district: user.district || "",
      bio: user.bio || "",
      avatar: user.avatar || "",
      role: user.role || "artisan",
      joinDate: user.createdAt || new Date(),
      totalCrafts: craftsCount,
      totalSales,
      totalReviews,
      averageRating,
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});


app.put("/api/profile",restrictDemoUser,verifyToken, async (req: Request, res: Response) => {
  const { email, name, phone, address, city, district, bio, avatar } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  try {
    const usersCollection = db.collection("user");

    // Build update object (only include fields that are provided)
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (district !== undefined) updateData.district = district;
    if (bio !== undefined) updateData.bio = bio;
    if (avatar !== undefined) updateData.avatar = avatar;

    // Update user
    const result = await usersCollection.updateOne(
      { email },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get updated user
    const updatedUser = await usersCollection.findOne({ email });

    // Get stats for response
    const craftsCount = await allCraftCollection.countDocuments({
      sellerEmail: email,
    });

    const crafts = await allCraftCollection
      .find({ sellerEmail: email })
      .toArray();
    const craftIds = crafts.map((c) => c._id.toString());

    const reviews = await reviewsCollection
      .find({ craftId: { $in: craftIds } })
      .toArray();

    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    let totalSales = 0;
    try {
      const collections = await db.listCollections().toArray();
      const hasOrdersCollection = collections.some(c => c.name === "Orders");

      if (hasOrdersCollection) {
        const salesResult = await ordersCollection.aggregate([
          { $match: { sellerEmail: email } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]).toArray();

        if (salesResult.length > 0) {
          totalSales = salesResult[0].total;
        }
      }
    } catch (error) {
      console.error("Sales calculation error:", error);
    }

    res.json({
      _id: updatedUser?._id,
      name: updatedUser?.name || "",
      email: updatedUser?.email,
      phone: updatedUser?.phone || "",
      address: updatedUser?.address || "",
      city: updatedUser?.city || "",
      district: updatedUser?.district || "",
      bio: updatedUser?.bio || "",
      avatar: updatedUser?.avatar || "",
      role: updatedUser?.role || "artisan",
      joinDate: updatedUser?.createdAt || new Date(),
      totalCrafts: craftsCount,
      totalSales,
      totalReviews,
      averageRating,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});


app.post("/api/profile/avatar",restrictDemoUser, async (req: Request, res: Response) => {
  
  try {
    
    const { email, avatar } = req.body;

    if (!email || !avatar) {
      return res.status(400).json({ message: "Email and avatar required" });
    }

    // Update user with avatar
    
    await usersCollection.updateOne(
      { email },
      { $set: { avatar } }
    );

    res.json({ message: "Avatar updated successfully", avatarUrl: avatar });
  } catch (error) {
    console.error("Avatar upload error:", error);
    res.status(500).json({ message: "Failed to upload avatar" });
  }
});



app.get("/api/settings",verifyToken, async (req: Request, res: Response) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  try {
    const usersCollection = db.collection("user");
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return settings (with defaults)
    res.json({
      name: user.name || "",
      email: user.email,
      phone: user.phone || "",
      notifications: user.notifications || {
        email: true,
        push: true,
        sms: false,
      },
      privacy: user.privacy || {
        profileVisibility: "public",
        showEmail: true,
        showPhone: false,
      },
      store: user.store || {
        name: "",
        description: "",
      },
      appearance: user.appearance || {
        theme: "dark",
      },
      language: user.language || "en",
      currency: user.currency || "BDT",
    });
  } catch (error) {
    console.error("Settings error:", error);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});


app.put("/api/settings",restrictDemoUser,verifyToken, async (req: Request, res: Response) => {
  const { email, section, data } = req.body;

  if (!email || !section || !data) {
    return res.status(400).json({ message: "Email, section, and data required" });
  }

  try {
    const usersCollection = db.collection("user");

    // Build update object based on section
    const updateData: any = {};
    
    if (section === "profile") {
      if (data.name) updateData.name = data.name;
      if (data.phone) updateData.phone = data.phone;
    } else if (section === "notifications") {
      updateData.notifications = data;
    } else if (section === "privacy") {
      updateData.privacy = data;
    } else if (section === "store") {
      updateData.store = data;
    } else if (section === "appearance") {
      updateData.appearance = data;
    } else if (section === "language") {
      updateData.language = data.language;
      updateData.currency = data.currency;
    } else if (section === "security") {
      // Handle password change
      // You should hash the password before saving
      // This is a simplified example
    }

    // Update user
    const result = await usersCollection.updateOne(
      { email },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get updated user
    const updatedUser = await usersCollection.findOne({ email });

    // Return updated settings
    res.json({
      name: updatedUser?.name || "",
      email: updatedUser?.email,
      phone: updatedUser?.phone || "",
      notifications: updatedUser?.notifications || {
        email: true,
        push: true,
        sms: false,
      },
      privacy: updatedUser?.privacy || {
        profileVisibility: "public",
        showEmail: true,
        showPhone: false,
      },
      store: updatedUser?.store || {
        name: "",
        description: "",
      },
      appearance: updatedUser?.appearance || {
        theme: "dark",
      },
      language: updatedUser?.language || "en",
      currency: updatedUser?.currency || "BDT",
    });
  } catch (error) {
    console.error("Settings update error:", error);
    res.status(500).json({ message: "Failed to update settings" });
  }
});




app.get("/api/reviews/public", async (req: Request, res: Response) => {
  try {
   
    const reviews = await reviewsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

   
    const reviewsWithTitles = await Promise.all(
      reviews.map(async (review) => {
        try {
          const craft = await allCraftCollection.findOne({
            _id: new ObjectId(review.craftId),
          });
          return {
            name: review.name || "Anonymous",
            comment: review.comment || "",
            rating: review.rating || 0,
            craftTitle: craft?.title || "Unknown Craft",
          };
        } catch (err) {
          return {
            name: review.name || "Anonymous",
            comment: review.comment || "",
            rating: review.rating || 0,
            craftTitle: "Unknown Craft",
          };
        }
      })
    );

    res.json(reviewsWithTitles);
  } catch (error) {
    console.error("Public reviews error:", error);
    res.status(500).json({ message: "Failed to fetch reviews" });
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