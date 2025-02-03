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
const MongoStore = require('connect-mongo');

const CALLBACK_URL = process.env.NODE_ENV === 'production'
    ? 'https://marathon-training-app.onrender.com/auth/google/callback'
    : 'http://localhost:3000/auth/google/callback';

const app = express();


const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;


// Connect to MongoDB
connectDB();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - MUST be before passport middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 24 * 60 * 60 // Session TTL in seconds (1 day)
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.DOMAIN}/auth/google/callback`,
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
}, async function(accessToken, refreshToken, profile, cb) {
    console.log('Google strategy callback received');
    try {
        console.log('Looking for existing user...');
        let user = await User.findOne({ googleId: profile.id });
        
        if (!user) {
            console.log('Creating new user...');
            user = await User.create({
                googleId: profile.id,
                email: profile.emails[0].value,
                displayName: profile.displayName
            });
            console.log('New user created:', user);
        } else {
            console.log('Existing user found:', user);
        }
        
        return cb(null, user);
    } catch (error) {
        console.error('Error in Google Strategy:', error);
        return cb(error, null);
    }
}));

passport.serializeUser((user, done) => {
    console.log('Serializing user:', user);
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    console.log('Deserializing user ID:', id);
    try {
        const user = await User.findById(id);
        console.log('Deserialized user:', user);
        done(null, user);
    } catch (error) {
        console.error('Deserialization error:', error);
        done(error, null);
    }
});

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'uploads/'));
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
        console.log('Starting Google authentication...');
        next();
    },
    passport.authenticate('google', { 
        scope: ['profile', 'email'],
        prompt: 'select_account'
    })
);

app.get('/auth/google/callback', 
    (req, res, next) => {
        console.log('Received callback from Google');
        next();
    },
    passport.authenticate('google', { 
        failureRedirect: '/',
        failureFlash: true
    }),
    (req, res) => {
        console.log('Authentication successful');
        console.log('User:', req.user);
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
// Update the dashboard route in server.js
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
                <title>Training Dashboard</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
            </head>
            <body class="bg-gray-50">
                <!-- Navigation Bar -->
                <nav class="bg-white shadow-lg">
                    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div class="flex justify-between h-16">
                            <div class="flex">
                                <div class="flex-shrink-0 flex items-center">
                                    <h1 class="text-2xl font-bold text-gray-800">Training Tracker</h1>
                                </div>
                            </div>
                            <div class="flex items-center">
                                ${isUserAdmin ? 
                                    `<a href="/admin/dashboard" class="mr-4 text-gray-600 hover:text-gray-900">
                                        <i class="fas fa-user-shield mr-2"></i>Admin
                                    </a>` : ''
                                }
                                <span class="mr-4 text-gray-600">
                                    <i class="fas fa-user mr-2"></i>${req.user.displayName}
                                </span>
                                <a href="/logout" class="text-red-600 hover:text-red-900">
                                    <i class="fas fa-sign-out-alt mr-2"></i>Logout
                                </a>
                            </div>
                        </div>
                    </div>
                </nav>

                <!-- Main Content -->
                <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                    <!-- Progress Overview -->
                    <div class="mb-8 bg-white rounded-lg shadow p-6">
                        <h2 class="text-xl font-semibold mb-4">Your Progress</h2>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="bg-blue-50 p-4 rounded-lg">
                                <div class="text-3xl font-bold text-blue-600">
                                    ${tasks.filter(t => t.completed).length}/${tasks.length}
                                </div>
                                <div class="text-sm text-gray-600">Tasks Completed</div>
                            </div>
                            <div class="bg-green-50 p-4 rounded-lg">
                                <div class="text-3xl font-bold text-green-600">
                                    ${tasks.filter(t => t.status === 'approved').length}
                                </div>
                                <div class="text-sm text-gray-600">Tasks Approved</div>
                            </div>
                            <div class="bg-yellow-50 p-4 rounded-lg">
                                <div class="text-3xl font-bold text-yellow-600">
                                    ${tasks.filter(t => !t.completed).length}
                                </div>
                                <div class="text-sm text-gray-600">Tasks Remaining</div>
                            </div>
                        </div>
                    </div>

                    <!-- Tasks List -->
                    <div class="bg-white rounded-lg shadow">
                        <div class="p-6">
                            <h2 class="text-xl font-semibold mb-4">Training Tasks</h2>
                            <div class="grid gap-6">
                                ${tasks.map(task => `
                                    <div class="border rounded-lg p-6 ${
                                        task.completed ? 'bg-gray-50' : 'bg-white'
                                    }">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <h3 class="text-lg font-semibold">
                                                    Task ${task.number}: ${task.title}
                                                </h3>
                                                <p class="text-gray-600 mt-1">${task.description}</p>
                                            </div>
                                            <div class="flex items-center">
                                                ${task.status === 'approved' ? 
                                                    '<span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">Approved</span>' :
                                                    task.status === 'rejected' ? 
                                                    '<span class="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">Rejected</span>' :
                                                    task.completed ?
                                                    '<span class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">Pending Review</span>' :
                                                    '<span class="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm">Not Started</span>'
                                                }
                                            </div>
                                        </div>
                                        
                                        ${task.completed ? `
                                            <div class="mt-4">
                                                ${task.screenshotUrl ? `
                                                    <div class="mt-2">
                                                        <img src="${task.screenshotUrl}" 
                                                             alt="Task Screenshot" 
                                                             class="rounded-lg max-w-md">
                                                    </div>
                                                ` : ''}
                                                ${task.feedback ? `
                                                    <div class="mt-4 p-4 bg-blue-50 rounded-lg">
                                                        <h4 class="font-semibold text-blue-900">Feedback:</h4>
                                                        <p class="text-blue-800">${task.feedback}</p>
                                                    </div>
                                                ` : ''}
                                            </div>
                                        ` : `
                                            <form action="/complete-task/${task._id}" 
                                                  method="POST" 
                                                  enctype="multipart/form-data"
                                                  class="mt-4">
                                                <div class="flex items-center">
                                                    <input type="file" 
                                                           name="screenshot" 
                                                           accept="image/*" 
                                                           required
                                                           class="block w-full text-sm text-gray-500
                                                                  file:mr-4 file:py-2 file:px-4
                                                                  file:rounded-full file:border-0
                                                                  file:text-sm file:font-semibold
                                                                  file:bg-blue-50 file:text-blue-700
                                                                  hover:file:bg-blue-100">
                                                    <button type="submit"
                                                            class="ml-4 px-4 py-2 bg-blue-600 text-white 
                                                                   rounded-lg hover:bg-blue-700 
                                                                   transition-colors">
                                                        Complete Task
                                                    </button>
                                                </div>
                                            </form>
                                        `}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
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
        const tasks = await Task.find({ completed: true })
            .populate({
                path: 'userId',
                select: 'displayName email'
            })
            .sort({ completedAt: -1 });

        const totalTasks = tasks.length;
        const approvedTasks = tasks.filter(t => t.status === 'approved').length;
        const pendingTasks = tasks.filter(t => t.status === 'pending').length;
        const rejectedTasks = tasks.filter(t => t.status === 'rejected').length;

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Dashboard - Training Tracker</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
                <script>
                    function previewImage(input) {
                        if (input.files && input.files[0]) {
                            const reader = new FileReader();
                            reader.onload = function(e) {
                                document.getElementById('preview').src = e.target.result;
                                document.getElementById('preview').style.display = 'block';
                            }
                            reader.readAsDataURL(input.files[0]);
                        }
                    }
                </script>
            </head>
            <body class="bg-gray-50 min-h-screen">
                <!-- Navigation -->
                <nav class="bg-white shadow-lg">
                    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div class="flex justify-between h-16">
                            <div class="flex items-center">
                                <h1 class="text-2xl font-bold text-gray-800">
                                    <i class="fas fa-shield-alt text-blue-600 mr-2"></i>
                                    Admin Dashboard
                                </h1>
                            </div>
                            <div class="flex items-center space-x-4">
                                <a href="/dashboard" class="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                                    <i class="fas fa-home mr-2"></i>Main Dashboard
                                </a>
                                <a href="/logout" class="text-red-600 hover:text-red-900 px-3 py-2 rounded-md text-sm font-medium">
                                    <i class="fas fa-sign-out-alt mr-2"></i>Logout
                                </a>
                            </div>
                        </div>
                    </div>
                </nav>

                <!-- Main Content -->
                <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <!-- Statistics Cards -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                        <div class="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-500">
                            <div class="flex items-center">
                                <div class="flex-shrink-0 bg-blue-100 rounded-md p-3">
                                    <i class="fas fa-tasks text-blue-600 text-xl"></i>
                                </div>
                                <div class="ml-4">
                                    <h2 class="text-gray-600 text-sm">Total Submissions</h2>
                                    <p class="text-2xl font-semibold text-gray-800">${totalTasks}</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-500">
                            <div class="flex items-center">
                                <div class="flex-shrink-0 bg-green-100 rounded-md p-3">
                                    <i class="fas fa-check-circle text-green-600 text-xl"></i>
                                </div>
                                <div class="ml-4">
                                    <h2 class="text-gray-600 text-sm">Approved</h2>
                                    <p class="text-2xl font-semibold text-gray-800">${approvedTasks}</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white rounded-xl shadow-md p-6 border-l-4 border-yellow-500">
                            <div class="flex items-center">
                                <div class="flex-shrink-0 bg-yellow-100 rounded-md p-3">
                                    <i class="fas fa-clock text-yellow-600 text-xl"></i>
                                </div>
                                <div class="ml-4">
                                    <h2 class="text-gray-600 text-sm">Pending Review</h2>
                                    <p class="text-2xl font-semibold text-gray-800">${pendingTasks}</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white rounded-xl shadow-md p-6 border-l-4 border-red-500">
                            <div class="flex items-center">
                                <div class="flex-shrink-0 bg-red-100 rounded-md p-3">
                                    <i class="fas fa-times-circle text-red-600 text-xl"></i>
                                </div>
                                <div class="ml-4">
                                    <h2 class="text-gray-600 text-sm">Rejected</h2>
                                    <p class="text-2xl font-semibold text-gray-800">${rejectedTasks}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tasks List -->
                    <div class="bg-white rounded-xl shadow-md">
                        <div class="p-6">
                            <h2 class="text-xl font-semibold text-gray-800 mb-6">
                                <i class="fas fa-list-check mr-2 text-blue-600"></i>
                                Task Submissions
                            </h2>
                            <div class="space-y-6">
                                ${tasks.map(task => `
                                    <div class="border rounded-xl p-6 hover:shadow-md transition-shadow duration-200">
                                        <div class="flex justify-between items-start">
                                            <div class="flex-1">
                                                <div class="flex items-center">
                                                    <h3 class="text-lg font-semibold text-gray-800">
                                                        Task ${task.number}: ${task.title}
                                                    </h3>
                                                    <span class="ml-3 px-3 py-1 ${
                                                        task.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                        task.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                                        'bg-yellow-100 text-yellow-800'
                                                    } rounded-full text-sm font-medium">
                                                        ${task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                                                    </span>
                                                </div>
                                                <p class="text-gray-600 mt-2">${task.description}</p>
                                                <div class="mt-3 text-sm text-gray-500 space-y-1">
                                                    <p>
                                                        <i class="fas fa-user mr-2"></i>
                                                        Submitted by: ${task.userId ? task.userId.displayName : 'Unknown'}
                                                    </p>
                                                    <p>
                                                        <i class="fas fa-envelope mr-2"></i>
                                                        ${task.userId ? task.userId.email : 'No email'}
                                                    </p>
                                                    <p>
                                                        <i class="fas fa-calendar mr-2"></i>
                                                        Submitted on: ${new Date(task.completedAt).toLocaleString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        ${task.screenshotUrl ? `
                                            <div class="mt-4">
                                                <p class="text-sm font-medium text-gray-700 mb-2">
                                                    <i class="fas fa-image mr-2"></i>Screenshot
                                                </p>
                                                <img src="${task.screenshotUrl}" 
                                                     alt="Task Screenshot" 
                                                     class="rounded-lg max-w-md shadow-sm hover:shadow-md transition-shadow duration-200">
                                            </div>
                                        ` : ''}

                                        <form class="mt-6 pt-6 border-t" action="/admin/review-task/${task._id}" method="POST">
                                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label class="block text-sm font-medium text-gray-700 mb-2">
                                                        Review Status
                                                    </label>
                                                    <select name="status" required
                                                            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                                                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Pending Review</option>
                                                        <option value="approved" ${task.status === 'approved' ? 'selected' : ''}>Approve</option>
                                                        <option value="rejected" ${task.status === 'rejected' ? 'selected' : ''}>Reject</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label class="block text-sm font-medium text-gray-700 mb-2">
                                                        Feedback to User
                                                    </label>
                                                    <textarea name="feedback" rows="3"
                                                              class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                                              placeholder="Provide feedback for the user...">${task.feedback || ''}</textarea>
                                                </div>
                                            </div>
                                            <div class="mt-4 flex justify-end">
                                                <button type="submit"
                                                        class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200">
                                                    <i class="fas fa-save mr-2"></i>Submit Review
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
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