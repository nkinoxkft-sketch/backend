import redis from "../redishconfig";
import logger from "../winstonown";


export const uploadDataToCache = async (userId, dataId, data) =>{

    try{

        const cacheKey = `userId:${userId}dataId:${dataId}`;

        await redis.set(cacheKey, JSON.stringify(data), { ex: 3600 });

    }catch(err){

        logger.error('/api/deleteConfirm', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

    }

}

export const downloadDataFromCache = async (userId, dataId) => {


}


import redis from './config/redis.js'; // A korábbi konfigurációs fájlod

// === ADAT MENTÉSE (Write) ===
const saveUserDataToCache = async (userId, userData) => {
    try {
        const cacheKey = `user:${userId}`;

        // Mivel a Redis stringként vagy JSON-ként tárol, 
        // az objektumot érdemes JSON.stringify-val átalakítani.
        // A 'EX' opcióval megadjuk a lejárati időt (TTL) másodpercben (pl. 3600 mp = 1 óra), 
        // így az adat idővel automatikusan törlődik, ha nem frissítik.
        await redis.set(cacheKey, JSON.stringify(userData), { ex: 3600 });

        console.log('Sikeres mentés a Redisbe!');
    } catch (error) {
        console.error('Hiba történt a Redis mentés során:', error);
    }
};

// === ADAT KIOLVASÁSA (Read) ===
const getUserDataFromCache = async (userId) => {
    try {
        const cacheKey = `user:${userId}`;

        // Lekérjük az adatot a Redisből
        const cachedData = await redis.get(cacheKey);

        if (!cachedData) {
            console.log('Cache miss: Nincs ilyen adat a Redisben, kérjük le az adatbázisból.');
            return null;
        }

        // Ha az Upstash SDK automatikusan nem parse-olná JSON-re, 
        // akkor stringify után itt JSON.parse() kell. 
        // (Az @upstash/redis kliens gyakran automatikusan visszahozza objektumként, 
        // de ha mégis string maradna: typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData)
        
        console.log('Cache hit: Adat betöltve a Redisből!');
        return cachedData;

    } catch (error) {
        console.error('Hiba történt a Redis olvasás során:', error);
        return null;
    }
};