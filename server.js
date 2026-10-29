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

//A BigInt.prototype.toJSON = function() { return this.toString(); };
// A JavaScript beépített JSON.stringify() függvénye alapértelmezetten
//  nem tudja kezelni a BigInt (nagyon nagy egész szám) típust, és egy 
// TypeError-t dobna. Mivel a Prisma ORM (amit a TiDB-vel is használsz) 
// a nagy számokat BigInt típusként adja vissza az adatbázisból, ez a kód 
// felülírja az alapértelmezett viselkedést: megmondja a JavaScriptnek, 
// hogy mielőtt JSON-t csinálna belőle, egyszerű szöveggé (string) alakítsa a számot. 
// Így hiba nélkül át tudod küldeni az adatokat a frontendnek. 
BigInt.prototype.toJSON = function() {
    return this.toString(); 

};


const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://192.168.56.1:5173',
  'http://192.168.1.50:5173',
  'https://cloudifytalk.com',
  'https://www.cloudifytalk.com',
  'https://curly-acorn-shank.ngrok-free.dev'
];

// CORS beállítása rögtön az elején
app.use(cors({
  origin: function (origin, callback) {
    // Engedjük a kérést, ha benne van a listában, vagy ha nincs origin (pl. szerver-szerver hívás)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('A CORS policy blokkolta ezt a forrást.'));
    }
  },
  credentials: true, // Sütikhez és Authorization fejlécekhez kötelező
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Ez kötelező, ha komplex kéréseket (POST, JSON data) küldesz!
app.options(/.*/, cors());
//Egy beépített Express middleware (köztes réteg).
//  A beérkező HTTP kérések nyers szöveges törzsét automatikusan átalakítja JavaScript objektummá,
//  így a végpontjaidon (pl. bejelentkezésnél) kényelmesen eléred a küldött adatokat a req.body.email vagy
app.use(express.json());
app.set('trust proxy', 1); // Express beállítása // elveszett ip cimek miatt

//A res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
// Ez a biztonsági fejléc (COOP) létfontosságú az OAuth (pl. Google bejelentkezés) 
// vagy külső fizetési kapuk (PayPal) működéséhez. Lehetővé teszi, hogy a weboldaladból
//  megnyíló biztonságos felugró (popup) ablakok a művelet végén vissza tudjanak kommunikálni a főoldaladhoz 
// (pl. átadják a sikeres fizetés vagy bejelentkezés tokenjét), ahelyett, hogy a böngésző memóriaszinten teljesen elszigetelné őket.

//A res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none'); Ez a COEP fejléc leglazább, alapértelmezett állapota. 
// Azt mondja meg a böngészőnek, hogy a weboldalad betölthet külső, harmadik féltől származó erőforrásokat 
// (például képeket egy CDN-ről vagy külső szkripteket) anélkül, hogy azok szigorú CORS jóváhagyást követelnének meg.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});


//A app.use(cookieParser()); A cookie-parser csomag middleware-je. 
// Amikor a böngésző elküldi a kérést, a sütiket egyetlen hosszú, nehezen olvasható szövegsorban (a Cookie fejlécben) küldi át.
//  Ez a sor ezt a szöveget automatikusan szétszedi, és berakja a req.cookies objektumba (például req.cookies.refresh_token),
//  hogy azonnal és könnyen tudd használni a hitelesítés során.
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

app.get('/api/getUserData', verify.verifyToken, async (req, res) => {

  const data = await prisma.users.findUnique({where: {id: req.user.userId}, select: { username: true, email: true} });
  console.log(data)
  res.status(200).json({ 

    userData: data,

  });
  
});


