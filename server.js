import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import loginRoute from './Login/login.js';
import registerRoute from './Login/register.js';
import forgotRoute from './update/forgot.js';
import verify from './Midleware/verify.js';
import updateUsername from './update/updateUsername.js';
import updateEmail from './update/updateEmail.js';
import subData from './Subscription/subData.js';
import payment from './Payment/payment.js';
import AiCom from './Aicomunication/AiCom.js';
import refresh from './Login/refresh.js'
import helmet from 'helmet';
import antrophic from './Aicomunication/antrophicapi.js'
import cookieParser from 'cookie-parser';
import { startSubscriptionChecker } from './timer.js';
import getVatRate from './Payment/invoice.js'
import deleteAcc from './update/delete.js';
import { prisma } from './database.js';


BigInt.prototype.toJSON = function() {
    return this.toString(); 

};

const app = express();
app.use(express.json());


app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

app.use(cookieParser());

process.on('uncaughtException', (err) => {
    logger.error('Végzetes szinkron hiba történt, a szerver leáll:', err);
   // process.exit(1); // 1 = hibával állunk le
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Kezeletlen aszinkron hiba (Hiányzó catch):', reason);
   // process.exit(1);
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM jelet kaptunk. Kulturált leállás megkezdése...');
    
    // 1. Bezárjuk a HTTP szervert (nem fogad új bejövő kéréseket a felhasználóktól)
    server.close(async () => {
        logger.info('HTTP szerver leállítva.');
        
        // 2. Szépen bontjuk a kapcsolatot a Prisma-val és a MySQL-lel
        await prisma.$disconnect();
        logger.info('Adatbázis kapcsolat bontva.');
        
        // 3. Most már biztonságosan kiléphetünk
        process.exit(0); // 0 = hiba nélküli, sikeres leállás
    });
});

const corsOptions = {
    origin: [
        'http://localhost:5173',  
        'http://192.168.1.50:5173',
        'http://172.20.10.4:5173'       
    ],
    optionsSuccessStatus: 200,
    credentials: true
};

app.use(cors(corsOptions));
app.use(helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }));

app.listen(8080, '0.0.0.0', () => {
  startSubscriptionChecker();
  console.log('Server running on port 8080');

});

app.use(loginRoute);
app.use(registerRoute);
app.use(forgotRoute);
app.use(updateUsername);
app.use(updateEmail);
app.use(subData);
app.use(payment);
app.use(AiCom);
app.use(refresh);
app.use(antrophic);
app.use(deleteAcc)

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '1mb' }));

getVatRate('FI');

app.get('/api/getData', verify.verifyToken, (req, res) => {
  
  console.log("A kérést küldő felhasználó adatai:", req.user);

  res.status(200).json({ 
    message: "Sikeresen bejutottál a védett zónába!",
    userData: req.user
  });
  
});



const Subscriptions = [

    {
    id: 1,
    title: "Basic",
    price: "$9.99 / month",
    desc: "Essential AI capabilities for everyday tasks and casual users.",
    data: [
      "4,000 credits per month",
      "~450 premium or 10,000 basic messages",
      "Access to Haiku, Sonnet, and Opus 5.5",
      "Unlimited chat history & sessions",
      "Markdown & code syntax highlighting",
      "Bulk document processing & large file uploads",
    ]
  },
  {
    id: 2,
    title: "Pro",
    price: "$19.99 / month",
    desc: "Advanced tools for developers, creators, and professionals.",
    data: [
      "10,000 credits per month",
      "~1,100 premium or 25,000 basic messages",
      "Access to Haiku, Sonnet, and Opus 5.5",
      "Unlimited chat history & sessions",
      "Markdown & code syntax highlighting",
      "Bulk document processing & large file uploads",
    ]
  },
  {
    id: 3,
    title: "Max",
    price: "$119.99 / month",
    desc: "Maximum performance for power users with heavy AI workloads.",
    data: [
      "75,000 credits per month",
      "~8,300 premium or 180,000 basic messages",
      "Access to Haiku, Sonnet, and Opus 5.5",
      "Unlimited chat history & sessions",
      "Markdown & code syntax highlighting",
      "Bulk document processing & large file uploads",
    ]
  }

  ];

app.get('/api/getDataPub', (req, res) => {
    console.log('adat keres')
  res.status(200).json({

    message: "Successfull login", 
    sub: Subscriptions,

  })


});

   //const [row] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);

    //return { id: row[0].id, username: row[0].username, email: row[0].email, subscription: row[0].subscription, emailCode: row[0].emailCode, emailCodeExpiry: row[0].emailCodeExpiry, newemail: row[0].newemail };


app.get('/api/getUserData', verify.verifyToken, async (req, res) => {

  const data = await prisma.users.findUnique({where: {id: req.user.userId}, select: { username: true, email: true} });
  console.log(data)
  res.status(200).json({ 

    userData: data,

  });
  
});


