const express = require('express')
const cors = require('cors')
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const port = process.env.PORT || 3000


const stripe = require('stripe')(process.env.STRIPE_SECRET);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_Password}@myfirst-cluster.32i1hy9.mongodb.net/?appName=myfirst-cluster`;


function generateTrackingId() {
  const prefix = "TRK";
  const date = new Date().toISOString().slice(0,10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  return `${prefix}-${date}-${random}`;
}

console.log(generateTrackingId());




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
    const paymentCollaction= db.collection('payments');

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
                name:`please Pay For ${paymentInfo.parcelName}`
              }
           },

            quantity: 1,
          },
        ],
        customer_email:paymentInfo.senderEmail,
        mode: 'payment',
        metadata:{
           parcelId:paymentInfo.parcelId,
           parcelName:paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      })
      console.log(session)
      res.send({url: session.url})
    });

    app.patch('/payment-success', async(req,res)=>{
           const sessionId=req.query.session_id

            const session = await stripe.checkout.sessions.retrieve(sessionId)
            // console.log('session Rettrive', session)
              const transactionId=session.payment_intent
              const query={transactionId:transactionId}

              const paymentExist= await paymentCollaction.findOne(query)
               if(paymentExist){
                 return res.send({message: 'Already Exist Transaction ID', transactionId, trackingId:paymentExist.trackingId})
               }
            const trackingId=generateTrackingId();

             if(session.payment_status === 'paid'){
                const id= session.metadata.parcelId;
                const query={_id: new ObjectId(id)}

                const update={
                  $set:{
                    paymentStatus: 'paid',
                    trackingId:trackingId
                  }
                }
                const result= await parcelCollaction.updateOne(query, update)
                const payment={
                  amount:session.amount_total/100,
                  currency:session.currency,
                  customerEmail:session.customer_email,
                  parcelId:session.metadata.parcelId,
                  parcelName:session.metadata.parcelName,
                  transactionId:session.payment_intent,
                  paymentStatus:session.payment_status,
                  paidAt: new Date(),
                  trackingId:trackingId

                }

                if(session.payment_status==='paid'){
                    const resultPayment= await paymentCollaction.insertOne(payment)
                    res.send({success: true, modifyparcel:result, trackingId:trackingId, transactionId:session.payment_intent, paymentInfo:resultPayment})
                }
             }
           
          //  res.send({success: false})
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
