import express from 'express';
import axios from 'axios';
import validateVAT from 'validate-vat';
import verify from '../Midleware/verify.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import { serverLog } from '../serverlog.js';
import { setPolling, getPolling } from './paymentDataBase.js';
import { buildSzamlazzXmlFromPaypal } from './invoice.js';
import logger from '../winstonown.js';
import { prisma } from '../database.js';
import { z } from 'zod'
import validator from '../Midleware/validator.js';
const serverlog = serverLog('payment')
const router = express.Router();

async function getPayPalAccessToken() {

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post('https://api-m.sandbox.paypal.com/v1/oauth2/token', 'grant_type=client_credentials', {
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return res.data.access_token;

}

// * ============================================================================
// * Create sub function
// * ============================================================================

const paymentSchema = z.object({

    name: z.string({ message: 'Name must be a string' })
    .max(250, { message: 'Name cannot exceed 250 characters' }) 
    .optional()
    .nullable(),

    vat: z.string({ message: 'Vat must be a string' })
    .max(250, { message: 'Vat cannot exceed 250 characters' }) 
    .optional()
    .nullable(),

    plan: z.enum(["Basic", "Pro", "Max"], { 
        errorMap: () => ({ message: 'Invalid plan selected. Must be Basic, Pro, or Max.' }) 
    })

})

const paymentValidator = validator.createValidator({

    Schema: paymentSchema

});

const plans = ["Basic", "Pro", "Max"]

const payment = rateLimiter.createRateLimiter({

    windowSeconds: 1 * 60,
    maxAttempts: 20,

});

const strictJsonLimit = express.json({ limit: '5kb' });


router.post('/api/create-subscription', strictJsonLimit, verify.verifyToken, payment, paymentValidator, async (req, res) => {

    const ip = req.ip;
    const userId = req.user?.userId;
    try {

        const { name, vat } = req.body;

        let { plan } = req.body

        logger.info('/api/payment', { userId: userId, ip: ip, productionOnly: true, message: 'Company datas', vat: vat, name: name, plan: plan }); 

        logger.info('/api/payment', { message: 'Arrived input', userId: userId, ip: ip, plan: plan }); 

        if(name && vat){

            if (vat.length < 4) {

                logger.info('/api/payment', { error: {message: 'Invalid vat number' }, userId: userId, success: 'false', ip: ip }); 

                return res.status(400).json({ error: "Invalid tax number provided." });
            }

            const countryCode = vat.slice(0, 2).toUpperCase();
            const vatNumber = vat.slice(2);

            const validationResult = await new Promise((resolve) => {
                validateVAT(countryCode, vatNumber, (err, validation) => {
                    if (err) resolve({ valid: false, error: err });
                    else resolve(validation);
                });
            });

            if (!validationResult || !validationResult.valid) {
                
                logger.info('/api/payment', { error: {message: 'The provided tax number is invalid or not found in the EU VIES system' }, userId: userId, success: 'false', ip: ip }); 

                return res.status(400).json({ 

                    error: "The provided tax number is invalid or not found in the EU VIES system" 
                });
            }


        }

        let planId;

        let change = 'none';

        let startTimeString;

        const { nextPlan, subscription_expiry, subscription_status} = await prisma.subscriptions.findFirst({ where: { user_id: userId} });

        logger.info('/api/payment', { userId: userId, ip: ip, nextPlan: nextPlan, expire: subscription_expiry }); 

        if(subscription_expiry){//vane lejarati datum azt jelenti volt mar csomag ez elott

            const expiryDate = new Date(Number(subscription_expiry));

            if(subscription_expiry > Date.now()){//ha nem jart le

                startTimeString = expiryDate.toISOString();

                if(nextPlan){ //Ha van kovetkezo csomag tervben vasarlasra

                    const tierMap = {
                        "Basic": 1,
                        "Pro": 2,
                        "Max": 3
                    };
                    const currentTier = tierMap[subscription_status] || 0;
                    const nextTier = tierMap[nextPlan] || 0;
                    const newTier = tierMap[plan] || 0;

                    logger.info('/api/payment', { userId: userId, ip: ip, currentTier: currentTier, nextTier: nextTier, newTier: newTier }); 
                    
                    if(subscription_status !== nextPlan){ //ha nem egyendlo a kovi a mostanival azt jelenti volt valtas

                        logger.info('/api/payment', { userId: userId, ip: ip, message: 'subscription_status !== nextplan' }); 

                        if (newTier > currentTier && nextTier !== newTier) {// Ha a nextplan Max a current Pro es new nem max
                            change = 'upgrade';
                            startTimeString = null
                        }
                        else if (newTier < currentTier && nextTier !== newTier) {// Ha a nextplan basic az current az Pro es new nem basic
                            change = 'downgrade';
                            
                        }
                        else if(newTier === currentTier){
                            
                            change = 'regrade';
                            
                        }
                        else{
                            
                            logger.info('/api/payment', { userId: userId, ip: ip, message: 'Bad request  (current_plan !== nextPlan)' }); 

                            return res.status(400).json({ error: "Bad request." });

                        }
                    }
                    else{
 
                        logger.info('/api/payment', { userId: userId, ip: ip, message: 'current_plan === nextplan' }); 

                        if (newTier > nextTier) {
                            change = 'upgrade';
                            startTimeString = null
                        }
                        if (newTier < nextTier) {
                            change = 'downgrade';
                        }
                        if(newTier === nextTier){
                            
                            logger.info('/api/payment', { userId: userId, ip: ip, message: 'Bad request (newTier === nextTier)' }); 

                            return res.status(400).json({ error: "Bad request." }); 
                            
                        }
                        

                    }


                }
                else{//nincs kovi csomag de most van aktiv azt jelenti le lett mondva

                    change = 'resub';

                } 

            }
            else{// ha lejart az elozo csomag akkor mindegy hogy upgade vagy mi

                change = 'createSimpleSub';

            }


        }
        else{// ha nincs lejarati datum egyatalan meg nem volt csomag

            change = 'createSimpleSub';

        }
    
        logger.info('/api/payment', { userId: userId, ip: ip, change: change, startTimeString: startTimeString }); 

        if(plan){
            
            if(plan === 'Basic'){

                planId = process.env.BASIC

            }
            if(plan === 'Pro'){
                
                planId = process.env.PRO

            }
            if(plan === 'Max'){
                
                planId = process.env.MAX
                
            }
        }

        logger.info('/api/payment', { userId: userId, ip: ip, planId: planId }); 

        const accessToken = await getPayPalAccessToken();

        const paypalPayload = {
            plan_id: planId,
            custom_id: `${userId.toString()}_${change}_${planId}_${plan}_${name}_${vat}`,
            change: change,
            application_context: {
                return_url: "http://localhost:5173",
                cancel_url: "http://localhost:5173",
                shipping_preference: "GET_FROM_FILE"
            }

        };

        if (startTimeString) {

            paypalPayload.start_time = startTimeString; 

        
        }


        const response = await axios.post('https://api-m.sandbox.paypal.com/v1/billing/subscriptions',  paypalPayload, 
            {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        await prisma.subscriptions.update( {where: {user_id: userId}, data: { pending_sub_id: response.data.id}} )

        await setPolling(userId, true)

        res.json({ subscriptionID: response.data.id });

    } catch (err) {

        logger.error('/api/create-subscription', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        res.status(500).json({ error: 'Unexpected error.' });

    }
});

// * ============================================================================
// * Cancel sub function
// * ============================================================================

export const cancelSubscription = async (current_subid_in_database) =>{

    const access_token = await getPayPalAccessToken()

    try{

        await axios.post(`https://api-m.sandbox.paypal.com/v1/billing/subscriptions/${current_subid_in_database}/cancel`, {
            reason: "User request"
        }, {
            headers: { 
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });

    }catch(err){

        logger.error('cancelSubscription', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            current_subid_in_database: current_subid_in_database
        });
    }


}

const refound = async (sale_id) =>{

    const access_token = await getPayPalAccessToken()

    try{

        await axios.post(
            `https://api-m.sandbox.paypal.com/v1/payments/sale/${sale_id}/refund`,
            {}, // Ha üres objektumot küldesz, az automatikusan TELJES visszatérítést jelent
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${access_token}`
                }
            }
        );

    }catch(err){

        logger.error('refound', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            sale_id: sale_id
        });
    }


}


router.post('/api/paypal-webhook', express.json(),  async (req, res) => {
    try {

        // * ============================================================================
        // * Verifycation
        // * ============================================================================

        const transmissionId = req.headers['paypal-transmission-id'];
        const timestamp = req.headers['paypal-transmission-time'];
        const webhookId = "76F605701X096651S";
        const certUrl = req.headers['paypal-cert-url'];
        const signature = req.headers['paypal-transmission-sig'];
        const authAlgo = req.headers['paypal-auth-algo'];
        const eventBody = req.body;
        const access_token = await getPayPalAccessToken();

        try{

            const verifyResponse = await axios.post(
                'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature', 
                {
                    auth_algo: authAlgo,
                    cert_url: certUrl,
                    transmission_id: transmissionId,
                    transmission_sig: signature,
                    transmission_time: timestamp,
                    webhook_id: webhookId,
                    webhook_event: eventBody
                },
                {
                    headers: {
                        'Authorization': `Bearer ${access_token}`, 
                        'Content-Type': 'application/json'
                    }
                }
            );

            const verificationStatus = verifyResponse.data.verification_status;

            if (verificationStatus !== 'SUCCESS') {

                logger.info('/api/paypal-webhook', { error: {message: 'verificationStatus Invalid signature' } });

                return res.status(400).send('Invalid signature');

            }
            
        }catch(err){

            logger.error('refound', {
                error: {
                    message: err.message,
                    stack: err.stack,
                    code: err.code
                },
            });

        }
        

        // * ============================================================================
        // * Handle hooks
        // * ============================================================================

        const event = req.body;
        const eventType = event.event_type;
        const resource = event.resource; 

        logger.info('/api/paypal-webhook', { Webhook: eventType } );

        if (eventType === 'BILLING.SUBSCRIPTION.CREATED') {

            const customUserId = resource.custom_id;

            let [userIdStr] = customUserId.split('_');
            
            const userId = Number(userIdStr);

            logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.CREATED', userId: userId } );

            await prisma.subscriptions.update( {where: { user_id: userId}, data: {pending_sub_id: resource.id} })
 
            return res.status(200).send('Succes')

        }

        if(eventType === 'BILLING.SUBSCRIPTION.CANCELLED'){

            const customUserId = resource.custom_id;

            let [userIdStr] = customUserId.split('_');
            
            const userId = Number(userIdStr);

            logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.CANCELLED', userId: userId } );

            const comming_subid_frompaypal = resource.id
            
            const { sub_id } = await prisma.subscriptions.findFirst( {where: {user_id: userId}} );

            logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.CANCELLED', current_subid_in_database: sub_id, comming_subid_frompaypal: comming_subid_frompaypal } );

            if(sub_id === comming_subid_frompaypal){

                logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.CANCELLED', info: 'Paypal webhook cancelled current_subid_in_database === comming_subid_frompaypal => canceled renew' } );

                await setPolling(userId, false);

                await prisma.subscriptions.update( { where: { user_id: userId}, data: { renewable: false, sub_id: null, nextPlan: null} } )
 
            }

            await setPolling(userId, false)

            return res.status(200).send('Succes')


        }
        
        if (eventType === 'PAYMENT.SALE.COMPLETED') {

            const comming_subid_frompaypal = resource.billing_agreement_id; 

            const customUserId = resource.custom;

            const [userIdStr, change, planId, planin, name, vat] = customUserId.split('_');

            const userId = Number(userIdStr);


            logger.info('/api/paypal-webhook', { message: 'PAYMENT.SALE.COMPLETED', userId: userId } );

            const accessToken = await getPayPalAccessToken();

            const id = resource.id;

            const { processed_webhook, pending_sub_id, sub_id } = await prisma.subscriptions.findFirst( { where: {user_id: userId} } );

            if(processed_webhook === id){

                logger.info('/api/paypal-webhook', { message: 'PAYMENT.SALE.COMPLETED', success: { message: 'processed_webhook === id'} } );

                return res.status(200);
            }

            // * ============================================================================
            // * Refound need to revise
            // * ============================================================================

            if (pending_sub_id !== comming_subid_frompaypal) {

                logger.info('/api/paypal-webhook', { message: 'PAYMENT.SALE.COMPLETED, Refound started due to bad request', pending_sub_id: pending_sub_id, comming_subid_frompaypal:comming_subid_frompaypal } );
                
                const saleId = resource.id; 

                await refound(saleId);

                await cancelSubscription(comming_subid_frompaypal);

                return res.status(200).send('Refunded duplicate');

                
            } 

            // * ============================================================================
            // * payment need to revise
            // * ============================================================================

            
            const response = await axios.get(

                `https://api-m.sandbox.paypal.com/v1/billing/subscriptions/${comming_subid_frompaypal}`,

                { headers: { Authorization: `Bearer ${accessToken}` } }

            );

            const subscription_expiry = response.data.billing_info.next_billing_time; // pl. "2026-11-12T10:00:00Z"
            const expiryDate = new Date(subscription_expiry);

            const expireNumber = expiryDate.getTime();

            logger.info('/api/paypal-webhook', { message: 'PAYMENT.SALE.COMPLETED', comming_subid_frompaypal: comming_subid_frompaypal, subscription_expiry:subscription_expiry, userId: userId, change: change, planId: planId  } );
                
            let plan;
            let messages
               
            if(planId === process.env.BASIC){

                plan = 'Basic';
                messages = 4000

            }
            if(planId === process.env.PRO){

                plan = 'Pro';
                messages = 10000

            }
            if(planId === process.env.MAX){

                plan = 'Max';
                messages = 75000
            }

            if(change === 'upgrade' || change === 'regrade' || change === 'resub' || change === 'downgrade' || change === 'createSimpleSub'){

                logger.info('/api/paypal-webhook', { message: 'PAYMENT.SALE.COMPLETED', change: change, userId:userId,  current_subid_in_database: sub_id, comming_subid_frompaypal: comming_subid_frompaypal, plan: plan, expireNumber: expireNumber, messages: messages} );

                await prisma.subscriptions.update( {where: { user_id: userId}, data: {remaining_credits: {increment: messages}, subscription_expiry: expireNumber, subscription_status: plan, nextPlan: plan,
                    sub_id: comming_subid_frompaypal, renewable: true, processed_webhook: id
                } } );

                if(change === 'upgrade'){

                    await cancelSubscription(sub_id);

                }

                await setPolling(userId, false)

                return res.status(200).send('Succes')
            
            }

            
        
           
        }
        if(eventType === 'BILLING.SUBSCRIPTION.ACTIVATED'){

            const comming_subid_frompaypal = resource.id;

            const customUserId = resource.custom_id;

            const [userIdStr, change, planId, plan, name, vat] = customUserId.split('_');
            
            const userId = Number(userIdStr);

            logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.ACTIVATED', userId: userId } );
           
            if(change === 'regrade' || change === 'resub' || change === 'downgrade'){

                const { sub_id } = await prisma.subscriptions.findFirst( { where: { user_id: userId } } )

                logger.info('/api/paypal-webhook', { message: 'BILLING.SUBSCRIPTION.ACTIVATED', comming_subid_frompaypal: comming_subid_frompaypal, current_subid_in_database: sub_id  } );
                
                if(change !== 'resub'){

                    await cancelSubscription(sub_id);

                }  

                await prisma.subscriptions.update( { where: { user_id: userId}, data: {nextPlan: plan, sub_id: comming_subid_frompaypal}  }) 
   
                await setPolling(userId, false)
                
                return res.status(200).send('Succes')
            }
            else{

                const xml = await buildSzamlazzXmlFromPaypal(resource, vat, plan, userId);

                serverlog.log('payment billing activated', `Invoice xml: ${xml} \n  \n  \n `)

                return res.status(200).send('Succes')
                
            }

           

        }

        res.status(200).send('Webhook catched');

    } catch (err) {

        logger.error('paypal-webhook', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },

        });

        res.status(500).json({ error: 'Unexpected error' });
    }
});

router.post('/api/paypal-cancel', verify.verifyToken, async (req, res) => {

    const ip = req.ip;

    try {

        const userId = req.user.userId;

        logger.info('/api/paypal-cancel', {userId: userId } );        

        await setPolling(userId, true)

        const { sub_id } = await prisma.subscriptions.findFirst( { where: {user_id: userId} } )

        if (!sub_id) {

            logger.info('/api/paypal-cancel', {error: {message: 'bad request', ip: ip, reqId: req.id}, userId: userId } );  

            return res.status(400).json({ error: 'Bad request.' });

        }

        logger.info('/api/paypal-cancel', {userId: userId, current_subid_in_database: sub_id } );    

        await cancelSubscription(sub_id)
  
        res.status(200).json({ 
            success: true, 
        });


    } catch (err) {

        logger.error('paypal-cancel', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },

        });

        res.status(500).json({ error: 'Unexpected error' });

    }
});

router.post('/api/paypal-cancel-purchase', verify.verifyToken, async (req, res) => {
    try {

        const userId = req.user.userId;

        await prisma.subscriptions.update( { where: { user_id: userId}, data: {sub_id: null}  } )
 
        res.status(200).json({ 
            success: true, 
        });

    } catch (err) {
        res.status(500).json({ error: 'Unexpected error' });
        logger.error('paypal-cancel', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },

        });
    }
});

router.get('/api/polling', verify.verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const polling = await getPolling(userId);

        res.status(200).json({ 
            success: true, 
            message: polling
        });

    } catch (err) {
        res.status(500).json({ error: 'Unexpected error' });
        logger.error('paypal-cancel', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },

        });
    }
});


export default router;