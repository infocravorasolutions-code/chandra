const express = require('express');
const router = express.Router();
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

router.post("/", async(req, res) => {
    try {
        // Log incoming request for debugging
        console.log('Login request received:', {
            body: req.body,
            headers: req.headers['content-type'],
            origin: req.headers.origin
        });

        // Handle both lowercase and capitalized field names from frontend
        const email = req.body.email || req.body.Email;
        const password = req.body.password || req.body.Password;

        // Validate request body
        if (!email || !password) {
            console.log('Missing email or password');
            return res.status(400).json({
                message: 'Email and password are required',
                received: { email: !!email, password: !!password }
            });
        }

        // Find user by email (try exact match first, then case-insensitive)
        let user = await User.findOne({ email: email });
        if (!user) {
            // Try case-insensitive lookup
            const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            user = await User.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') });
        }
        if(!user) {
            console.log('User not found for email:', email);
            return res.status(400).json({message: 'Invalid email or Password'});
        }

        // const isMatch = await bcrypt.compare(password, user.password);
        const isMatch = password == user.password;

        if(!isMatch) {
            console.log('Password mismatch for email:', email);
            return res.status(400).json({message: 'Invalid email or Password'});
        }

        const token = jwt.sign(
        {
            Id: user._id,
            Role: user.role,
        },
            process.env.JWT_SECRET
        );

        console.log('Login successful for email:', email);
        res.json({token});
    }
    catch (error) {
        console.log("Error during login", error);
        res.status(500).json({ message: "server error", error: error.message});
    }
});

module.exports = router;

