import { serverLog } from '../serverlog.js';
import axios from'axios';
import FormData from'form-data';
import fs from 'fs';
import { prisma } from '../database.js';

const serverlog = serverLog('invoice')

export const EU_VAT_RATES = {

AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22,

ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22,

LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 19,

SE: 25, SI: 22, SK: 20

}; 

let cached_vat;

const API_KEY = process.env.VATLAYER_API_KEY || '9f5acdbc472e6bf6c82f88e0ea2548c9';

// 1. Memóriabeli tároló a kulcsoknak
const vatCache = new Map();

// Utolsó sikeres frissítés időpontja
let lastFetchedAt = 0;

// Cache érvényességi ideje: 24 óra milliszekundumban
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Frissíti a cache-t a vatlayer API-ból és for ciklussal feldolgozza
 */
export async function refreshVatRatesCache() {
  try {
    console.log('🔄 Áfakulcsok frissítése a vatlayer-ről...');
    const response = await fetch(`http://apilayer.net/api/rate_list?access_key=${API_KEY}`);
    const data = await response.json();

    if (!data.success || !data.rates) {
      throw new Error(data.error?.info || 'Nem sikerült lekérni az áfakulcsokat');
    }

    // 2. Végigmegyünk az adatokon ciklussal és feltöltjük a cache-t
    // data.rates formátuma: { "HU": { standard_rate: 27, ... }, "DE": { ... } }
    for (const [countryCode, info] of Object.entries(data.rates)) {
      vatCache.set(countryCode.toUpperCase(), {
        countryName: info.country_name,
        standardRate: info.standard_rate,
        reducedRates: info.reduced_rates || []
      });
    }

    lastFetchedAt = Date.now();
    console.log(`✅ Áfakulcsok cache-elve: ${vatCache.size} ország mentve.`);

  } catch (err) {
    console.error('❌ Hiba az áfakulcs cache frissítésekor:', err.message);
  }
}

/**
 * Lekéri az adott ország áfakulcsát a memóriából (ha lejárt, automatikusan frissít)
 */
export default async function getVatRate(countryCode) {

  if (!countryCode) return 0;
  const code = countryCode.trim().toUpperCase();

  // Ha üres a cache vagy lejárt a 24 óra, frissítünk
  const isExpired = Date.now() - lastFetchedAt > CACHE_TTL_MS;
  if (vatCache.size === 0 || isExpired) {
    await refreshVatRatesCache();
  }

  // Ha a vatlayer-ben benne van, visszaadjuk a standard_rate-et
  if (vatCache.has(code)) {
    console.log(vatCache.get(code).standardRate)
    return vatCache.get(code).standardRate;
  }

  // Fallback (ha EU-n kívüli ország vagy ismeretlen)
  return 0;
}

export function parseInclusiveTax(grossStr, countryCode, isCompanyWithVat = false) {
  const gross = parseFloat(grossStr);
  const country = (countryCode || '').toUpperCase();

  // 1. EU-n KÍVÜLI VEVŐ (pl. US, CA, GB) -> 0% áfa, területi hatályon kívül
  if (vatCache.get(countryCode).standardRate === 0) {
    return {
      vatRate: 'TEHK',
      netAmount: gross.toFixed(2),
      vatAmount: '0.00',
      grossAmount: gross.toFixed(2),
      comment: 'Áfa területi hatályán kívüli ügylet (Áfa tv. 37. §).'
    };
  }

  // 2. EU-S CÉG (VIES adószámmal) -> 0% fordított adózás (Reverse Charge)
  if (isCompanyWithVat && country !== 'HU') {
    return {
      vatRate: 'EUFAD37',
      netAmount: gross.toFixed(2),
      vatAmount: '0.00',
      grossAmount: gross.toFixed(2),
      comment: 'Fordított adózás / Reverse charge (Áfa tv. 37. §).'
    };
  }

  // 3. MAGYAR VÁSÁRLÓ -> 27% normál áfa
  if (country === 'HU') {
    const net = gross / 1.27;
    const vat = gross - net;
    return {
      vatRate: '27',
      netAmount: net.toFixed(2),
      vatAmount: vat.toFixed(2),
      grossAmount: gross.toFixed(2),
      comment: ''
    };
  }

  // 4. EU-S MAGÁNSZEMÉLY (OSS) -> Célország áfakulcsa
  const rate = vatCache.get(countryCode).standardRate;
  const net = gross / (1 + rate / 100);
  const vat = gross - net;

  return {
    vatRate: `${rate}`,
    netAmount: net.toFixed(2),
    vatAmount: vat.toFixed(2),
    grossAmount: gross.toFixed(2),
    comment: `OSS értékesítés (${country} - ${rate}% ÁFA).`
  };
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const  buildSzamlazzXmlFromPaypal = async (paypalData, vat, desc, userid) =>  {

  serverlog.log('Create Invoice', '-------------Server log create invoice------------- \n')

  try{

    const today = new Date().toISOString().split('T')[0];

    const payer = paypalData.subscriber || {};
    const payerName = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ') || 'Vásárló';
    const payerEmail = payer.email_address || '';
    
    const address = paypalData.subscriber.shipping_address.address || {};
    const country = address.country_code || 'HU';
    const zip = address.postal_code || '0000';
    const city = address.admin_area_2 || 'N/A';
    const street = address.address_line_1 || 'N/A';
    const payer_id = payer.payer_id;

    let isCompany = false;
    let taxNumber

    if(vat !== ''){

      isCompany = true;

      taxNumber = vat.trim().toUpperCase();

      if (taxNumber.startsWith('HU')) {
        taxNumber = taxNumber.substring(2);
      }

    }


    const data = parseInclusiveTax(paypalData.billing_info?.last_payment?.amount.value, country, isCompany);

    const grossAmount = data.grossAmount
    const vatRate = data.vatRate;
    const netAmount = data.netAmount;
    const vatAmount = data.vatAmount;
    const currency = paypalData.billing_info?.last_payment?.amount.currency_code

    const isHuf = currency === 'HUF';
    const bankName = isHuf ? '' : 'MNB';
    const exchangeRate = isHuf ? '0.0' : '0.0'; 

    const productName = desc || 'Subscription';
    const transactionId = paypalData.id || '';

    serverlog.log('Create Invoice', `userId: ${userid}, currency: ${currency}, grossAmount: ${grossAmount}, netAmount: ${netAmount}
      vatAmount: ${vatAmount}, vatRate: ${vatRate}, payerName: ${payerName}, country: ${country}, zip: ${zip}, city: ${city}, street: ${street},
      payer_id: ${payer_id}    \n`)


    await prisma.invoices.create( { data: {user_id: userid, currency: currency, gross_amount: grossAmount, net_amount: netAmount, vat_amount: vatAmount,
      vat_rate: vatRate, billing_name: payerName, billing_country: country, billing_postal_code: zip, billing_city: city, billing_address_line: street, paypal_payer_id: payer_id
    }} )

    serverlog.log('Create Invoice', '-------------Server log create invoice end------------- \n')

    const xml =  `<?xml version="1.0" encoding="UTF-8"?>
    <xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
      <beallitasok>
        <szamlaagentkulcs>${process.env.SZAMLAZZ_AGENT_KEY}</szamlaagentkulcs>
        <eszamla>true</eszamla>
        <szamlaLetoltes>true</szamlaLetoltes>
        <valaszVerzio>1</valaszVerzio>
      </beallitasok>

      <fejlec>
        <keltDatum>${today}</keltDatum>
        <teljesitesDatum>${today}</teljesitesDatum>
        <fizetesiHataridoDatum>${today}</fizetesiHataridoDatum>
        <fizmod>PayPal</fizmod>
        <penznem>${currency}</penznem>
        <szamlaNyelve>${country === 'HU' ? 'hu' : 'en'}</szamlaNyelve>
        <megjegyzes>PayPal tranzakció: ${escapeXml(transactionId)}</megjegyzes>
        <arfolyamBank>${bankName}</arfolyamBank>
        <arfolyam>${exchangeRate}</arfolyam>
        <rendelesSzam>${escapeXml(transactionId)}</rendelesSzam>
        <dijbekero>false</dijbekero>
        <szamlaszamElotag></szamlaszamElotag>
        <fizetve>true</fizetve>
      </fejlec>

      <elado></elado>

      <vevo>
        <nev>${escapeXml(payerName)}</nev>
        <orszag>${escapeXml(country)}</orszag>
        <irsz>${escapeXml(zip)}</irsz>
        <telepules>${escapeXml(city)}</telepules>
        <cim>${escapeXml(street)}</cim>
        <email>${escapeXml(payerEmail)}</email>
        <sendEmail>true</sendEmail>
        <adoszam>${taxNumber}</adoszam>
      </vevo>

      <tetelek>
        <tetel>
          <megnevezes>${escapeXml(productName)}</megnevezes>
          <mennyiseg>1.0</mennyiseg>
          <mennyisegiEgyseg>db</mennyisegiEgyseg>
          <nettoEgysegar>${netAmount}</nettoEgysegar>
          <afakulcs>${vatRate}</afakulcs>
          <nettoErtek>${netAmount}</nettoErtek>
          <afaErtek>${vatAmount}</afaErtek>
          <bruttoErtek>${grossAmount}</bruttoErtek>
        </tetel>
      </tetelek>
    </xmlszamla>`;

    return xml;

  }catch(err){

    console.log(err)

  }

}

  export const testInvoice = async () =>{

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
    <beallitasok>
      <szamlaagentkulcs>45a8qpcu7522va33wbpf7522vanxr93a7522vabusv</szamlaagentkulcs>
      <eszamla>true</eszamla>
      <szamlaLetoltes>true</szamlaLetoltes>
      <valaszVerzio>1</valaszVerzio>
    </beallitasok>

    <fejlec>
      <keltDatum>2026-09-29</keltDatum>
      <teljesitesDatum>2026-09-29</teljesitesDatum>
      <fizetesiHataridoDatum>2026-09-29</fizetesiHataridoDatum>
      <fizmod>PayPal</fizmod>
      <penznem>USD</penznem>
      <szamlaNyelve>hu</szamlaNyelve>
      <megjegyzes>PayPal tranzakció: I-82X1E44TRVVC</megjegyzes>
      <arfolyamBank>MNB</arfolyamBank>
      <arfolyam>0.0</arfolyam>
      <rendelesSzam>I-82X1E44TRVVC</rendelesSzam>
      <dijbekero>false</dijbekero>
      <szamlaszamElotag>TESZT</szamlaszamElotag>
      <fizetve>true</fizetve>
    </fejlec>

    <elado></elado>

    <vevo>
      <nev>John DoeskipKYC</nev>
      <orszag>HU</orszag>
      <irsz>1051</irsz>
      <telepules>Budapest</telepules>
      <cim>Erzsebet Ter 9-10</cim>
      <email>sb-agaqb52558596@personal.example.com</email>
      <sendEmail>true</sendEmail>
      <adoszam>33091152</adoszam>
    </vevo>

    <tetelek>
      <tetel>
        <megnevezes>Max</megnevezes>
        <mennyiseg>1.0</mennyiseg>
        <mennyisegiEgyseg>db</mennyisegiEgyseg>
        <nettoEgysegar>111.99</nettoEgysegar>
        <afakulcs>27</afakulcs>
        <nettoErtek>111.99</nettoErtek>
        <afaErtek>30.24</afaErtek>
        <bruttoErtek>142.23</bruttoErtek>
      </tetel>
    </tetelek>
  </xmlszamla>`

  const form = new FormData();

    form.append('action-xmlagentxmlfile', Buffer.from(xml, 'utf-8'), {
      filename: 'szamla.xml',
      contentType: 'text/xml',
    });


    try {
      // 3. Küldés az Axios segítségével
      const response = await axios.post('https://www.szamlazz.hu/szamla/', form, {
        headers: {
          ...form.getHeaders(), // Ez állítja be a multipart/form-data boundary-t automatikusan
        },
        // arraybuffer kell, ha a PDF-et is vissza szeretnéd kapni
        responseType: 'arraybuffer',
      });

      // 4. A Számlázz.hu a válasz HEADEREKBEN küldi az eredményt
      const headers = response.headers;
      const errorCode = headers['szlahu_error_code'];

      if (errorCode) {
        // Hiba történt (a Számlázz.hu HTTP 200 mellett is küldhet hibakódot a headerben!)
        const errorMessage = decodeURIComponent(headers['szlahu_error'] || '');
        console.error(`Számlázz.hu Hiba (${errorCode}): ${errorMessage}`);
        return;
      }

      // Sikeres hívás adatainak kiolvasása
      const invoiceNumber = headers['szlahu_szamlaszam'];
      const netPrice = headers['szlahu_nettoar'];
      const grossPrice = headers['szlahu_bruttoar'];

      console.log('Sikeres számlagenerálás!');
      console.log(`Számlaszám: ${invoiceNumber}`);
      console.log(`Nettó összeg: ${netPrice} HUF`);
      console.log(`Bruttó összeg: ${grossPrice} HUF`);

      // Ha <szamlaLetoltes>true</szamlaLetoltes>, akkor a response.data maga a PDF bináris tartalma
      if (response.data && response.data.length > 0) {
        fs.writeFileSync('kiallitott_szamla.pdf', response.data);
        console.log('A számla PDF fájl mentve: kiallitott_szamla.pdf');
      }

    } catch (error) {
      console.error('Hálózati vagy Axios hiba történt:', error.message);
    }


}