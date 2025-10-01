const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
// IMPORTANT: db now uses async functions (get, all, run) from the pg client
const db = require('../database/connection'); 

// Route to render payments page (FIXED - ASYNC)
router.get('/', async (req, res) => {
    const userId = req.session && req.session.user ? req.session.user.id : req.query.user_id;

    if (!userId) {
        return res.status(400).send('User ID is required.');
    }

    try {
        // Updated to use lowercase 'users'
        const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);

        if (!user) {
            return res.status(404).send('User not found.');
        }

        const subscriptionId = req.query.subscription_id;
        
        // Updated to use lowercase 'subscriptions'
        const query = subscriptionId
            ? 'SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2'
            : 'SELECT * FROM subscriptions WHERE user_id = $1';
        const params = subscriptionId ? [subscriptionId, userId] : [userId];

        // ASYNC Call: Fetch subscription data
        const subscriptions = await db.all(query, params);

        if (!subscriptions || subscriptions.length === 0) {
            return res.render('payments', { 
                user_id: user.id, 
                subscriptions: [], 
                stripePublicKey: process.env.STRIPE_PUBLIC_KEY, 
                message: 'No subscriptions found.' 
            });
        }
        
        // Determine if the "Extend" option should be allowed for each subscription
        const currentDate = new Date();
        subscriptions.forEach((subscription) => {
            const expiryDate = new Date(subscription.expiry);
            const daysRemaining = Math.ceil((expiryDate - currentDate) / (1000 * 60 * 60 * 24));
            
            subscription.allowExtend = daysRemaining <= 7;
        });
        
        // Render payments page with subscriptions
        res.render('payments', {
            user_id: user.id,
            subscriptions,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
            message: null
        });

    } catch (err) {
        console.error('Error fetching data for payments page:', err);
        return res.status(500).send('Error loading payments page.');
    }
});

router.post('/create-checkout-session', async (req, res) => {
    const { subscription_name, amount, subscription_id, payment_type } = req.body;
    const sanitizedAmount = Math.round(parseFloat(amount) * 100);

    if (isNaN(sanitizedAmount) || sanitizedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount value' });
    }

    try {
        // Updated to use lowercase 'payments'
        const payments = await db.all(
            `SELECT * FROM payments WHERE subscription_id = $1 AND status = 'succeeded'`,
            [subscription_id]
        );

        const hasNormalPayment = payments.some(payment => payment.payment_type === 'normal');
        const hasExtendPayment = payments.some(payment => payment.payment_type === 'extend');

        if (hasNormalPayment && payment_type === 'normal') {
            return res.status(400).json({ error: 'You have already made a normal payment for this subscription.' });
        }

        if (hasExtendPayment && payment_type === 'normal') {
            return res.status(400).json({ error: 'You cannot make a normal payment after extending this subscription.' });
        }

        if (payment_type === 'extend') {
            // Updated to use lowercase 'subscriptions'
            const subscription = await db.get('SELECT expiry FROM subscriptions WHERE id = $1', [subscription_id]);

            if (!subscription) {
                return res.status(404).send('Subscription not found.');
            }

            const expiryDate = new Date(subscription.expiry);
            const daysRemaining = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

            if (daysRemaining > 7) {
                return res.status(400).json({ error: 'Extension is not allowed for this subscription.' });
            }
        }
        
        // Proceed with Stripe checkout session creation
        await createStripeSession(res, subscription_name, sanitizedAmount, subscription_id, payment_type);

    } catch (error) {
        console.error('Error in checkout session creation:', error);
        return res.status(500).json({ error: 'Server error while checking payment rules.' });
    }
});


// Function to create a Stripe checkout session (remains ASYNC)
async function createStripeSession(res, subscription_name, sanitizedAmount, subscription_id, payment_type) {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'inr',
                        product_data: { name: subscription_name || 'Subscription' },
                        unit_amount: sanitizedAmount,
                    },
                    quantity: 1,
                },
            ],
            success_url: `${res.req.headers.origin}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${res.req.headers.origin}/payments/`,
            metadata: { subscription_id, payment_type },
        });

        res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('Error creating Stripe session:', error);
        res.status(500).json({ error: 'Failed to create Stripe session' });
    }
}

// Route to handle payment success (remains ASYNC)
router.get('/success', async (req, res) => {
    const sessionId = req.query.session_id;

    if (!sessionId) {
        console.error('Session ID is missing in the query parameters');
        return res.status(400).send('Session ID is missing');
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session || !session.payment_intent) {
            console.error('Invalid session or missing payment_intent');
            return res.status(400).send('Invalid session or missing payment intent');
        }

        const paymentIntent = session.payment_intent;
        const paymentDetails = await stripe.paymentIntents.retrieve(paymentIntent);

        if (paymentDetails.status === 'succeeded') {
            await proceedWithPayment(sessionId);
            res.redirect(`/payments`);
        } else {
            console.error('Payment not completed. Status:', paymentDetails.status);
            res.redirect('/payments');
        }
    } catch (error) {
        console.error('Error handling payment success:', error);
        res.status(500).send('Error processing payment.');
    }
});

// Helper function to insert data after successful payment (FIXED - ASYNC)
async function proceedWithPayment(sessionId) {
    try {
        if (!sessionId) {
            console.error('Session ID is missing');
            return;
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session || !session.metadata || !session.metadata.subscription_id) {
            console.error('Session or subscription_id is missing');
            return;
        }

        const subscriptionId = session.metadata.subscription_id;
        const paymentType = session.metadata.payment_type;
        const paymentIntentId = session.payment_intent;
        const paymentDetails = await stripe.paymentIntents.retrieve(paymentIntentId);
        const customerDetails = session.customer_details;

        const status = paymentDetails.status === 'succeeded' ? 'succeeded' : 'failed';

        // Updated to use lowercase 'subscriptions'
        const subscription = await db.get('SELECT * FROM subscriptions WHERE id = $1', [subscriptionId]);

        if (!subscription) {
            console.error(`Subscription not found for ID: ${subscriptionId}`);
            return;
        }

        // Updated to use lowercase 'payments'
        const insertPaymentSql = `
            INSERT INTO payments (payment_id, user_id, subscription_id, subscription_name, amount, currency, status, payment_type, payment_method, latest_charge, payment_intent_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
        await db.run(
            insertPaymentSql,
            [
                paymentIntentId,
                subscription.user_id,
                subscription.id,
                subscription.name,
                paymentDetails.amount / 100,
                paymentDetails.currency,
                status,
                paymentType,
                paymentDetails.payment_method,
                paymentDetails.latest_charge,
                paymentIntentId,
            ]
        );

        // Updated to use lowercase 'payerdetails'
        const insertPayerDetailsSql = `
            INSERT INTO payerdetails (payment_id, user_id, payer_name, payer_email, address_country)
            VALUES ($1, $2, $3, $4, $5)
        `;
        await db.run(
            insertPayerDetailsSql,
            [
                paymentIntentId,
                subscription.user_id,
                customerDetails.name,
                customerDetails.email,
                customerDetails.address.country,
            ]
        );

        // Update subscription dates if paymentType is "extend"
        if (paymentType === 'extend') {
            await updateSubscriptionDates(subscription);
        }
    } catch (error) {
        console.error('Error processing payment:', error);
    }
}

// Function to update subscription dates for "extend" payment type (FIXED - ASYNC)
async function updateSubscriptionDates(subscription) {
    try {
        const currentExpiry = new Date(subscription.expiry);
        // Calculate new start and expiry dates
        const newStartDate = new Date(currentExpiry);
        newStartDate.setDate(currentExpiry.getDate() + 1);

        const newExpiryDate = new Date(newStartDate);
        newExpiryDate.setDate(newStartDate.getDate() + 30); // Extend by 30 days

        // Updated to use lowercase 'subscriptions'
        const updateSubscriptionSql = `
            UPDATE subscriptions SET start = $1, expiry = $2 WHERE id = $3
        `;
        await db.run(
            updateSubscriptionSql,
            [newStartDate.toISOString(), newExpiryDate.toISOString(), subscription.id]
        );
    } catch (error) {
        console.error('Error updating subscription dates:', error);
    }
}

module.exports = router;
