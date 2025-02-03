require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const path = require('path');
const { connectDB } = require('./config/database');
const User = require('./models/User');
const Task = require('./models/Task');

const app = express();

// Connect to MongoDB
connectDB();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - MUST be before passport middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "http://localhost:3000/auth/google/callback",
            userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
        },
        async function(accessToken, refreshToken, profile, cb) {
            try {
                console.log('Google profile:', profile); // Debug log
                let user = await User.findOne({ googleId: profile.id });
                
                if (!user) {
                    user = await User.create({
                        googleId: profile.id,
                        email: profile.emails[0].value,
                        displayName: profile.displayName
                    });
                }
                
                return cb(null, user);
            } catch (error) {
                console.error('Google Strategy Error:', error);
                return cb(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Serve static files
app.use('/uploads', express.static('uploads'));

// Test route
app.get('/test', (req, res) => {
    res.send('Server is working');
});

// Auth Routes
app.get('/auth/google',
    (req, res, next) => {
        console.log('Starting Google authentication'); // Debug log
        next();
    },
    passport.authenticate('google', { 
        scope: ['profile', 'email'],
        prompt: 'select_account'
    })
);

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login' }),
    function(req, res) {
        console.log('Google authentication successful'); // Debug log
        res.redirect('/dashboard');
    }
);

// Main routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Marathon Training Tracker</title>
        </head>
        <body style="font-family: Arial, sans-serif; margin: 40px;">
            <h1>Marathon Training Tracker</h1>
            <div>
                <a href="/auth/google" style="
                    display: inline-block;
                    background-color: #4285f4;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    font-family: Arial, sans-serif;">
                    Login with Google
                </a>
            </div>
        </body>
        </html>
    `);
});


// Dashboard route
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    
    try {
        const tasks = await Task.find();
        const isUserAdmin = process.env.ADMIN_EMAILS?.split(',').includes(req.user.email);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Dashboard</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .task-card { 
                        border: 1px solid #ddd; 
                        margin: 10px 0; 
                        padding: 15px;
                        border-radius: 5px;
                    }
                </style>
            </head>
            <body>
                <h1>Welcome ${req.user.displayName}</h1>
                ${isUserAdmin ? '<a href="/admin/dashboard">Go to Admin Dashboard</a> | ' : ''}
                <a href="/logout">Logout</a>
                
                <h2>Your Tasks:</h2>
                <div>
                    ${tasks.map(task => `
                        <div class="task-card">
                            <h3>Task ${task.number}: ${task.title}</h3>
                            <p>${task.description}</p>
                            ${task.completed 
                                ? `<p>✅ Completed</p>
                                   ${task.screenshotUrl 
                                     ? `<img src="${task.screenshotUrl}" alt="Task Screenshot" style="max-width: 200px;"/>` 
                                     : ''}`
                                : `<form action="/complete-task/${task._id}" method="POST" enctype="multipart/form-data">
                                    <input type="file" name="screenshot" accept="image/*" required>
                                    <button type="submit">Mark as Complete</button>
                                   </form>`
                            }
                        </div>
                    `).join('')}
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});


// Admin middleware
const isAdmin = async (req, res, next) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
    if (!adminEmails.includes(req.user.email)) {
        return res.status(403).send('Access denied: Admin only');
    }
    
    next();
};

// Admin routes
app.get('/admin', isAdmin, (req, res) => {
    res.redirect('/admin/dashboard');
});

// ... (rest of your admin routes)

// Add this right after your admin middleware in server.js

app.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        // Fetch all tasks with populated user information
        const tasks = await Task.find({ completed: true }).populate({
            path: 'userId',
            select: 'displayName email'
        }).sort({ completedAt: -1 });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Dashboard</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        margin: 20px;
                        padding: 20px;
                    }
                    .nav-bar {
                        background-color: #f8f9fa;
                        padding: 15px;
                        margin-bottom: 20px;
                        border-radius: 5px;
                    }
                    .task-card { 
                        border: 1px solid #ddd; 
                        margin: 15px 0; 
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .screenshot { 
                        max-width: 200px;
                        border-radius: 4px;
                        margin: 10px 0;
                    }
                    .status-pending { color: orange; }
                    .status-approved { color: green; }
                    .status-rejected { color: red; }
                    .review-form {
                        margin-top: 15px;
                        padding-top: 15px;
                        border-top: 1px solid #eee;
                    }
                    select, textarea, button {
                        margin: 5px 0;
                        padding: 8px;
                        border-radius: 4px;
                        border: 1px solid #ddd;
                    }
                    button {
                        background-color: #4285f4;
                        color: white;
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: #3574e2;
                    }
                    .nav-link {
                        text-decoration: none;
                        color: #4285f4;
                        margin-right: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="nav-bar">
                    <h1>Admin Dashboard</h1>
                    <a href="/dashboard" class="nav-link">User Dashboard</a>
                    <a href="/logout" class="nav-link">Logout</a>
                </div>

                <h2>Completed Tasks (${tasks.length})</h2>
                <div>
                    ${tasks.map(task => `
                        <div class="task-card">
                            <h3>Task ${task.number}: ${task.title}</h3>
                            <p><strong>Description:</strong> ${task.description}</p>
                            <p><strong>User:</strong> ${task.userId ? task.userId.displayName : 'Unknown'} 
                                (${task.userId ? task.userId.email : 'No email'})</p>
                            <p><strong>Completed:</strong> ${task.completedAt ? 
                                new Date(task.completedAt).toLocaleString() : 'Date not recorded'}</p>
                            <p><strong>Status:</strong> 
                                <span class="status-${task.status || 'pending'}">
                                    ${task.status || 'pending'}
                                </span>
                            </p>
                            ${task.feedback ? `<p><strong>Feedback:</strong> ${task.feedback}</p>` : ''}
                            ${task.screenshotUrl ? 
                                `<img src="${task.screenshotUrl}" alt="Task Screenshot" class="screenshot"/>` : 
                                '<p>No screenshot available</p>'}
                            <form class="review-form" action="/admin/review-task/${task._id}" method="POST">
                                <div>
                                    <select name="status" required>
                                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>
                                            Pending Review
                                        </option>
                                        <option value="approved" ${task.status === 'approved' ? 'selected' : ''}>
                                            Approve
                                        </option>
                                        <option value="rejected" ${task.status === 'rejected' ? 'selected' : ''}>
                                            Reject
                                        </option>
                                    </select>
                                </div>
                                <div>
                                    <textarea name="feedback" 
                                        placeholder="Provide feedback to the user" 
                                        rows="3" 
                                        style="width: 100%;">${task.feedback || ''}</textarea>
                                </div>
                                <button type="submit">Submit Review</button>
                            </form>
                        </div>
                    `).join('')}
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).send('Error loading admin dashboard');
    }
});

// Handle task review submissions
app.post('/admin/review-task/:taskId', isAdmin, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { status, feedback } = req.body;
        
        await Task.findByIdAndUpdate(taskId, {
            status,
            feedback,
            reviewedAt: new Date(),
            reviewedBy: req.user._id
        });

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Review submission error:', error);
        res.status(500).send('Error submitting review');
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Google OAuth is configured with:');
    console.log(`Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not Set'}`);
    console.log(`Client Secret: ${process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not Set'}`);
    console.log(`Admin Emails: ${process.env.ADMIN_EMAILS || 'Not Set'}`);
});