const express = require('express')
const cors = require('cors')
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const e = require('express');
require('dotenv').config()
const port = process.env.PORT || 3000


const admin = require("firebase-admin");

const serviceAccount = require("./zapify-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});




const stripe = require('stripe')(process.env.STRIPE_SECRET);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_Password}@myfirst-cluster.32i1hy9.mongodb.net/?appName=myfirst-cluster`;


function generateTrackingId() {
  const prefix = "TRK";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `${prefix}-${date}-${random}`;
}



// middleware
app.use(express.json());
app.use(cors());


const verifyFireBaseToken = async (req, res, next) => {

  const token = req.headers?.authorization
  // console.log('Headers in Middleware: ', token)

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {
    const tokenId = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(tokenId)
    console.log('Decoded In the token: ', decoded)

    req.decoded_email = decoded.email
    next();
  } catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

}




const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    const db = client.db('ZapifyDB');
    const userCollaction = db.collection('users');
    const parcelCollaction = db.collection('parcelsDB');
    const paymentCollaction = db.collection('payments');
    const ridersCollaction = db.collection('riders');
    const trackingsCollaction = db.collection('trackings');


    // MiddleWare Amin Before Allowing admin activity
    // Must be Use After FireBase Token Verifiy middleware


    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email }

      const user = await userCollaction.findOne(query)

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access!' })
      }
      next()

    }


    const logTracking=async(trackingId, status)=>{
         const log={
             trackingId,
             status,
             details:status.split('_').join(' '),
             createdAt: new Date()
         }

         const result= await trackingsCollaction.insertOne(log)
         return result;
    }

    // Users API
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date()
      const email = user.email;

      const userExist = await userCollaction.findOne({ email })
      if (userExist) {
        return res.send({ message: 'User Exist' })
      }

      const result = await userCollaction.insertOne(user)
      res.send(result)
    })

    app.get('/users', verifyFireBaseToken, async (req, res) => {

      const SearchText = req.query.SearchText
      const query = {}
      if (SearchText) {
        //  query.displayName={$regex: SearchText, $options: 'i'}
        query.$or = [
          { displayName: { $regex: SearchText, $options: 'i' } },
          { email: { $regex: SearchText, $options: 'i' } },
        ]
      }
      const cursor = userCollaction.find(query).sort({ createdAt: -1 })
      const result = await cursor.toArray()
      res.send(result)
    })

    app.get('/users/:id', async (req, res) => {

    })

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email
      const query = { email }

      const user = await userCollaction.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    app.patch('/users/:id/role', verifyFireBaseToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) }

      const updateDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const result = await userCollaction.updateOne(query, updateDoc)
      res.send(result)

    })



    // Parcel Related Api
    app.get('/parcels', async (req, res) => {
      const query = {}
      const { email, deliveryStatus } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus
      }

      const Options = { sort: { createdAt: -1 } }
      const cursor = parcelCollaction.find(query, Options)
      const result = await cursor.toArray()
      res.send(result)
    });

    app.get('/parcels/rider', async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query
      const query = {}
      if (riderEmail) {
        query.riderEmail = riderEmail
      }
      if (deliveryStatus !== 'parcel_Delivered') {
        // query.deliveryStatus={$in: ['rider-assign', 'rider_arriving']}
        query.deliveryStatus = { $nin: ['parcel_Delivered'] }
      }else{
         query.deliveryStatus=deliveryStatus
      }

      const cursor = parcelCollaction.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })



    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await parcelCollaction.findOne(query)
      res.send(result)
    })

    // Aggregation 
    app.get('/parcels/delivery/stats', async(req,res)=>{
      const pipeline=[
        {
          $group:{
            _id:'$deliveryStatus',
            count: {$sum: 1}
          }
        }
      ]
      const result= await parcelCollaction.aggregate(pipeline).toArray()
      res.send(result)
    })

    app.post('/parcels', async (req, res) => {
      const parcel = req.body
      // Parcel Created Time
      parcel.createdAt = new Date()
      const result = await parcelCollaction.insertOne(parcel)
      res.send(result)
    });

    app.patch('/parcels/:id', async (req, res) => {
      const { riderId, riderName, riderEmail,trackingId } = req.body
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const updateDoc = {
        $set: {
          deliveryStatus: 'rider-assign',
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail

        }
      }

      const result = await parcelCollaction.updateOne(query, updateDoc)
      // Update Rider Information 

      const riderQuery = { _id: new ObjectId(riderId) }
      const riderUpdatedDoc = {
        $set: {
          workStatus: 'On The Way'
        }
      }
      const riderResult = await ridersCollaction.updateOne(riderQuery, riderUpdatedDoc)

      // log tracking
         logTracking(trackingId, 'rider-assign')
      res.send(riderResult)
    })


    app.patch('/parcels/:id/status', async (req, res) => {
      const { deliveryStatus,riderId,trackingId} = req.body
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          deliveryStatus: deliveryStatus
        }
      }

      if (deliveryStatus === 'parcel_Delivered') {

        const riderQuery = { _id: new ObjectId(riderId) }
        const riderUpdatedDoc = {
          $set: {
            workStatus: 'Available'
          }
        }
        const riderResult = await ridersCollaction.updateOne(riderQuery, riderUpdatedDoc)
      }
      const result = await parcelCollaction.updateOne(query, updateDoc)
      // Log tracking
      logTracking(trackingId,deliveryStatus)
      res.send(result)
    })

    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await parcelCollaction.deleteOne(query)
      res.send(result)
    });

    //  Payment Related Apis

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      const amount = parseInt(paymentInfo.cost) * 100

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: `please Pay For ${paymentInfo.parcelName}`
              }
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      })
      console.log(session)
      res.send({ url: session.url })
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id

      const session = await stripe.checkout.sessions.retrieve(sessionId)
      // console.log('session Rettrive', session)
      const transactionId = session.payment_intent
      const query = { transactionId: transactionId }

      const paymentExist = await paymentCollaction.findOne(query)
      if (paymentExist) {
        return res.send({ message: 'Already Exist Transaction ID', transactionId, trackingId: paymentExist.trackingId })
      }
      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }

        const update = {
          $set: {
            paymentStatus: 'paid',
            deliveryStatus: 'pending-pickup',
            trackingId: trackingId
          }
        }
        const result = await parcelCollaction.updateOne(query, update)
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId

        }

        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollaction.insertOne(payment)
          logTracking(trackingId, 'parcel_paid')
          res.send({ success: true, modifyparcel: result, trackingId: trackingId, transactionId: session.payment_intent, paymentInfo: resultPayment })
        }
      }

      //  res.send({success: false})
    })

    //  Payment Related Api
    app.get('/payments', verifyFireBaseToken, async (req, res) => {
      const email = req.query.email
      const query = {}

      //  console.log('headers :', req.headers)

      if (email) {
        query.customerEmail = email

        //  check email Address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }

      const cursor = paymentCollaction.find(query).sort({ paidAt: -1 })
      const result = await cursor.toArray()
      res.send(result)
    })

    // Rider Related Api 

    app.get('/riders', async (req, res) => {
      const { status, riderDistrict, workStatus } = req.query;
      const query = {}

      if (status) {
        query.status = status
      }
      if (riderDistrict) {
        query.riderDistrict = riderDistrict
      }
      if (workStatus) {
        query.workStatus = workStatus
      }

      const cursor = ridersCollaction.find(query).sort({ createdAt: -1 })
      const result = await cursor.toArray();
      res.send(result);
    })


    app.post('/riders', async (req, res) => {
      const riderInfo = req.body
      riderInfo.status = 'pending';
      riderInfo.createdAt = new Date();

      const result = await ridersCollaction.insertOne(riderInfo)
      res.send(result)

    })

    app.patch('/riders/:id', verifyFireBaseToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          status: status,
          workStatus: 'Available'
        }
      }
      const result = await ridersCollaction.updateOne(query, updateDoc)
      if (status === 'Approved') {
        const email = req.body.email
        const userQuery = { email }
        const updateUser = {
          $set: {
            role: 'rider'
          }
        }
        const userResult = await userCollaction.updateOne(userQuery, updateUser)

      }
      res.send(result)
    })

    // Tracking Related Api
    app.get('/trackings/:trackingId/logs', async(req,res)=>{
      const trackingId=req.params.trackingId
      const query={trackingId};

      const result=await trackingsCollaction.find(query).toArray();
      res.send(result)

    })

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Zapify Is Running Well!!!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
