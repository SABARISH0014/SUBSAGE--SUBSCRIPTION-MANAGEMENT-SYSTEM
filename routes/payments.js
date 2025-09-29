const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Stripe Secret Key
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const router = express.Router();
const db = require('../database/connection'); // Raw sqlite3 connection

// Load environment variables
dotenv.config();

// Route to render payments page
router.get('/', (req, res) => {
    const userId = req.session && req.session.user ? req.session.user.id : req.query.user_id;
    const subscriptionId = req.query.subscription_id;

    if (!userId) {
        return res.status(400).send('User ID is required.');
    }

    // Fetch user data from the database
    db.get('SELECT * FROM Users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            console.error('Error fetching user details:', err);
            return res.status(500).send('Error fetching user details.');
        }

        if (!user) {
            return res.status(404).send('User not found.');
        }

        // Fetch subscription data
        const query = subscriptionId
            ? 'SELECT * FROM Subscriptions WHERE id = ? AND user_id = ?'
            : 'SELECT * FROM Subscriptions WHERE user_id = ?';
        const params = subscriptionId ? [subscriptionId, userId] : [userId];

        db.all(query, params, (err, subscriptions) => {
            if (err) {
                console.error('Error fetching subscriptions:', err.message);
                return res.render('payments', { 
                    user_id: user.id, 
                    subscriptions: [], 
                    stripePublicKey: process.env.STRIPE_PUBLIC_KEY, 
                    message: 'Error fetching subscriptions. Please try again later.' 
                });
            }
        
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
        
                // Add a flag to indicate if "Extend" is allowed
                subscription.allowExtend = daysRemaining <= 7;
            });
        
            // Render payments page with subscriptions
            res.render('payments', {
                user_id: user.id,
                subscriptions,
                stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
                message: null // No error
            });
        });
        
    });
});

router.post('/create-checkout-session', async (req, res) => {
    const { subscription_name, amount, subscription_id, payment_type } = req.body;
    const sanitizedAmount = Math.round(parseFloat(amount) * 100); // Convert to smallest unit (paise)

    if (isNaN(sanitizedAmount) || sanitizedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount value' });
    }

    // Check if a successful payment exists for this subscription
    db.all(
        `SELECT * FROM Payments WHERE subscription_id = ? AND status = 'succeeded'`,
        [subscription_id],
        (err, payments) => {
            if (err) {
                console.error('Error checking previous payments:', err);
                return res.status(500).json({ error: 'Database error while checking payment history.' });
            }

            // Check if a normal payment exists
            const hasNormalPayment = payments.some(payment => payment.payment_type === 'normal');
            // Check if an extend payment exists
            const hasExtendPayment = payments.some(payment => payment.payment_type === 'extend');

            // Block normal payment if a successful normal payment already exists
            if (hasNormalPayment && payment_type === 'normal') {
                return res.status(400).json({ error: 'You have already made a normal payment for this subscription.' });
            }

            // Block normal payment if an extension payment exists
            if (hasExtendPayment && payment_type === 'normal') {
                return res.status(400).json({ error: 'You cannot make a normal payment after extending this subscription.' });
            }

            // If payment type is "extend", check if extension is allowed
            if (payment_type === 'extend') {
                db.get('SELECT expiry FROM Subscriptions WHERE id = ?', [subscription_id], (err, subscription) => {
                    if (err) {
                        console.error('Error fetching subscription:', err);
                        return res.status(500).send('Error fetching subscription.');
                    }

                    if (!subscription) {
                        return res.status(404).send('Subscription not found.');
                    }

                    const expiryDate = new Date(subscription.expiry);
                    const daysRemaining = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

                    if (daysRemaining > 7) {
                        return res.status(400).json({ error: 'Extension is not allowed for this subscription.' });
                    }

                    // Proceed with Stripe checkout session creation
                    createStripeSession(res, subscription_name, sanitizedAmount, subscription_id, payment_type);
                });
            } else {
                // Proceed with Stripe checkout session creation for normal payment
                createStripeSession(res, subscription_name, sanitizedAmount, subscription_id, payment_type);
            }
        }
    );
});


// Function to create a Stripe checkout session
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

        console.log('Stripe session created:', session);
        res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('Error creating Stripe session:', error);
        res.status(500).json({ error: 'Failed to create Stripe session' });
    }
}

// Route to handle payment success
router.get('/success', async (req, res) => {
    const sessionId = req.query.session_id;

    // Check if session_id is provided in the query
    if (!sessionId) {
        console.error('Session ID is missing in the query parameters');
        return res.status(400).send('Session ID is missing');
    }

    try {
        // Retrieve Stripe session details
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session || !session.payment_intent) {
            console.error('Invalid session or missing payment_intent');
            return res.status(400).send('Invalid session or missing payment intent');
        }

        // Confirm payment intent
        const paymentIntent = session.payment_intent;
        const paymentDetails = await stripe.paymentIntents.retrieve(paymentIntent);

        if (paymentDetails.status === 'succeeded') {
            console.log('Payment successful:', paymentDetails);

            // Proceed with payment processing
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

        const subscription = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM Subscriptions WHERE id = ?', [subscriptionId], (err, subscription) => {
                if (err) reject(err);
                else resolve(subscription);
            });
        });

        if (!subscription) {
            console.error(`Subscription not found for ID: ${subscriptionId}`);
            return;
        }

        // Insert payment details
        const insertPaymentSql = `
            INSERT INTO Payments (payment_id, user_id, subscription_id, subscription_name, amount, currency, status, payment_type, payment_method, latest_charge, payment_intent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(
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

        const insertPayerDetailsSql = `
            INSERT INTO PayerDetails (payment_id, user_id, payer_name, payer_email, address_country)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.run(
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

// Function to update subscription dates for "extend" payment type
async function updateSubscriptionDates(subscription) {
    try {
        const currentExpiry = new Date(subscription.expiry);
        const newStartDate = new Date(currentExpiry);
        newStartDate.setDate(currentExpiry.getDate() + 1);

        const newExpiryDate = new Date(newStartDate);
        newExpiryDate.setDate(newStartDate.getDate() + 30); // Extend by 30 days

        const updateSubscriptionSql = `
            UPDATE Subscriptions SET start = ?, expiry = ? WHERE id = ?
        `;
        db.run(
            updateSubscriptionSql,
            [newStartDate.toISOString(), newExpiryDate.toISOString(), subscription.id]
        );
    } catch (error) {
        console.error('Error updating subscription dates:', error);
    }
}

module.exports = router;
