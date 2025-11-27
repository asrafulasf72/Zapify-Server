const express = require('express')
const cors = require('cors')
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const port = process.env.PORT || 3000


const stripe = require('stripe')(process.env.STRIPE_SECRET);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_Password}@myfirst-cluster.32i1hy9.mongodb.net/?appName=myfirst-cluster`;


// middleware
app.use(express.json());
app.use(cors());

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
    const parcelCollaction = db.collection('parcelsDB');

    app.get('/parcels', async (req, res) => {
      const query = {}
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const Options = { sort: { createdAt: -1 } }
      const cursor = parcelCollaction.find(query, Options)
      const result = await cursor.toArray()
      res.send(result)
    });

    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await parcelCollaction.findOne(query)
      res.send(result)
    })

    app.post('/parcels', async (req, res) => {
      const parcel = req.body
      // Parcel Created Time
      parcel.createdAt = new Date()
      const result = await parcelCollaction.insertOne(parcel)
      res.send(result)
    });


    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await parcelCollaction.deleteOne(query)
      res.send(result)
    });

    //  Payment Related Apis

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      const amount = parseInt(paymentInfo.cost)*100

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
           price_data:{
              currency:'USD',
              unit_amount:amount,
              product_data:{
                name:paymentInfo.parcelName
              }
           },

            quantity: 1,
          },
        ],
        customer_email:paymentInfo.senderEmail,
        mode: 'payment',
        metadata:{
           parcelId:paymentInfo.parcelId
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      })
      console.log(session)
      res.send({url: session.url})
    });



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
