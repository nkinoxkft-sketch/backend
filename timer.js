import cron from 'node-cron';
import { prisma } from './database.js';

export const startSubscriptionChecker = () => {

    cron.schedule('0 * * * *', async () => {
        console.log('⏰ [CRON] Checking subscriptions...');

        try {

            const now = Date.now();

            const expiredUsers = await prisma.subscriptions.findMany({ where: { subscription_expiry: { lt: now} }, select: { id: true }})

        

            if (expiredUsers.length === 0) {
                console.log('✅ [CRON] All subscription is active.');
                return;
            }

            const ids = expiredUsers.map(user => user.id);

            await prisma.subscriptions.updateMany({ where : {id: {in : ids}}, data: { subscription_status : 'inactive', subscription_expiry: null, renewable: false,
                remaining_credits: 0, sub_id: null, nextPlan: null
            }})
          
            console.log(`🔄 [CRON] Sikeresen visszaminősítve ${expiredUsers.length} felhasználó.`);

        } catch (error) {
 
            console.error('❌ [CRON] Hiba az előfizetések ellenőrzésekor:', error);
        }
    });
};