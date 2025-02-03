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

const fs = require('fs');
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});



// Connect to MongoDB
connectDB();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - MUST be before passport middleware
app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 24 * 60 * 60 // Session TTL in seconds (1 day)
    }),
    cookie: {
        secure: true, // Required for production
        sameSite: 'none', // Required for production
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true
    },
    proxy: true // Required for production
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
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'marathon-training',
        allowed_formats: ['jpg', 'png', 'gif'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
        format: 'jpg'
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.mimetype)) {
            const error = new Error('Only .png, .jpg and .gif format allowed!');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error, false);
        }
        cb(null, true);
    }
});

app.post('/complete-task/:taskId', upload.single('screenshot'), async (req, res) => {
    try {
        console.log('Task completion request received:', req.params.taskId);
        
        if (!req.isAuthenticated()) {
            console.log('User not authenticated');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!req.file) {
            console.log('No file uploaded');
            return res.status(400).json({ error: 'Screenshot is required' });
        }
        console.log('Uploaded file details:', JSON.stringify(req.file, null, 2));

        const taskId = req.params.taskId;
        const screenshotUrl = req.file.secure_url || req.file.url || req.file.path;
        const userId = req.user._id;

        console.log('Screenshot URL:', screenshotUrl); // For debugging
        console.log('Updating task with screenshot:', screenshotUrl);

        // Update the task with user-specific status
        const updatedTask = await Task.findOneAndUpdate(
            { _id: taskId },
            {
                $push: {
                    userTasks: {
                        userId: userId,
                        completed: true,
                        screenshotUrl: screenshotUrl,
                        completedAt: new Date(),
                        status: 'pending'
                    }
                }
            },
            { new: true }
        );

        if (!updatedTask) {
            console.log('Task not found');
            return res.status(404).json({ error: 'Task not found' });
        }

        console.log('Task updated successfully:', updatedTask);

        // If using email notifications
        if (process.env.ADMIN_EMAIL && process.env.EMAIL_USER) {
            try {
                await sendTaskCompletionEmail(req.user, updatedTask, screenshotUrl);
                console.log('Notification email sent');
            } catch (emailError) {
                console.error('Error sending email:', emailError);
                // Continue even if email fails
            }
        }

        // Redirect back to dashboard
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({ error: 'Error completing task' });
    }
});

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((err, req, res, next) => {
    console.error('Error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large! Maximum size is 5MB.' });
    }
    if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Something went wrong!' });
});

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

// Add this route to test Cloudinary configuration
app.get('/test-cloudinary', async (req, res) => {
    try {
        const config = {
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            hasApiKey: !!process.env.CLOUDINARY_API_KEY,
            hasApiSecret: !!process.env.CLOUDINARY_API_SECRET,
            cloudinaryConfig: cloudinary.config()
        };
        
        res.json({
            status: 'success',
            config: config
        });
    } catch (error) {
        res.json({
            status: 'error',
            error: error.message
        });
    }
});

// Update the dashboard route to properly display images
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    
    try {
        const tasks = await Task.find({ isTemplate: true });
        const userId = req.user._id;
        const isUserAdmin = process.env.ADMIN_EMAILS?.split(',').includes(req.user.email);
        // Map tasks to include user-specific status
        const userTasks = tasks.map(task => {
            const userTask = task.userTasks.find(ut => ut.userId.equals(userId));
            return {
                _id: task._id,
                number: task.number,
                title: task.title,
                description: task.description,
                completed: userTask ? userTask.completed : false,
                screenshotUrl: userTask ? userTask.screenshotUrl : null,
                status: userTask ? userTask.status : null,
                feedback: userTask ? userTask.feedback : null,
                completedAt: userTask ? userTask.completedAt : null
            };
        });
        
        userTasks.sort((a, b) => a.number - b.number);

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
                            <div class="flex items-center">
                                <h1 class="text-2xl font-bold text-gray-800">Training Tracker</h1>
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
                <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <!-- Tasks List -->
                    <div class="bg-white rounded-lg shadow">
                        <div class="p-6">
                            <h2 class="text-xl font-semibold mb-4">Your Tasks</h2>
                            <div class="grid gap-6">
                                ${tasks.map(task => `
                                    <div class="border rounded-lg p-6 ${task.completed ? 'bg-gray-50' : 'bg-white'}">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <h3 class="text-lg font-semibold">Task ${task.number}: ${task.title}</h3>
                                                <p class="text-gray-600 mt-1">${task.description}</p>
                                            </div>
                                            <div class="flex items-center">
                                                ${task.status ? 
                                                    `<span class="px-3 py-1 ${
                                                        task.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                        task.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                                        'bg-yellow-100 text-yellow-800'
                                                    } rounded-full text-sm">
                                                        ${task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                                                    </span>` : ''
                                                }
                                            </div>
                                        </div>
                                        
                                        ${task.completed ? `
                                            <div class="mt-4">
                                                ${task.screenshotUrl ? `
                                                    <div class="mt-4">
                                                        <h4 class="text-sm font-medium text-gray-700 mb-2">Screenshot:</h4>
                                                        <img src="${task.screenshotUrl}" 
                                                             alt="Task Screenshot" 
                                                             class="rounded-lg max-w-xl shadow-sm hover:shadow-md transition-shadow duration-200"/>
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
                                            <form action="/complete-task/${task._id}" method="POST" enctype="multipart/form-data" class="mt-4">
                                                <div class="flex flex-col space-y-2">
                                                    <label class="text-sm font-medium text-gray-700">
                                                        Upload Screenshot:
                                                    </label>
                                                    <input type="file" 
                                                           name="screenshot" 
                                                           accept="image/*" 
                                                           required
                                                           class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                                                    <button type="submit"
                                                            class="inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                                        <i class="fas fa-check mr-2"></i>Complete Task
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
        const tasks = await Task.find()
            .populate({
                path: 'userTasks.userId',
                select: 'displayName email'
            });
        
                    // Flatten the tasks and user submissions for display
        const submissions = tasks.flatMap(task => 
            task.userTasks.map(userTask => ({
                taskId: task._id,
                taskNumber: task.number,
                taskTitle: task.title,
                taskDescription: task.description,
                userName: userTask.userId?.displayName || 'Unknown User',
                userEmail: userTask.userId?.email || 'No email',
                completed: userTask.completed,
                screenshotUrl: userTask.screenshotUrl,
                status: userTask.status,
                feedback: userTask.feedback,
                completedAt: userTask.completedAt
            }))
        ).sort((a, b) => b.completedAt - a.completedAt);

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

// Add these routes for testing
app.get('/session-test', (req, res) => {
    res.json({
        sessionId: req.sessionID,
        isAuthenticated: req.isAuthenticated(),
        session: req.session
    });
});

app.get('/env-test', (req, res) => {
    res.json({
        nodeEnv: process.env.NODE_ENV,
        domain: process.env.DOMAIN,
        hasSecret: !!process.env.SESSION_SECRET,
        hasMongoUri: !!process.env.MONGODB_URI
    });
});

// Logout route
app.get('/logout', (req, res) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// Add this temporary route to migrate data
app.get('/admin/migrate-tasks', isAdmin, async (req, res) => {
    try {
        // Get all existing tasks
        const tasks = await Task.find();
        
        // Update each task to use the new schema
        for (const task of tasks) {
            await Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        isTemplate: true,
                        userTasks: []
                    }
                }
            );
        }
        
        res.send('Migration completed');
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).send('Error during migration');
    }
});

// Add this route to create default tasks
app.get('/admin/initialize-tasks', isAdmin, async (req, res) => {
    try {
        // First, check if we already have template tasks
        const existingTasks = await Task.find({ isTemplate: true });
        
        if (existingTasks.length === 0) {
            // Create default tasks
            const defaultTasks = [
                { number: 1, title: "5K Training Run", description: "Complete a 5K training run at comfortable pace", isTemplate: true },
                { number: 2, title: "Interval Training", description: "Complete 6x400m interval training", isTemplate: true },
                { number: 3, title: "Long Run", description: "Complete a 10K long run", isTemplate: true },
                { number: 4, title: "Recovery Run", description: "30-minute easy recovery run", isTemplate: true },
                { number: 5, title: "Tempo Run", description: "25-minute tempo run at half marathon pace", isTemplate: true },
                { number: 6, title: "Hill Training", description: "Complete 6 hill repeats", isTemplate: true },
                { number: 7, title: "Distance Run", description: "Complete a 15K run", isTemplate: true },
                { number: 8, title: "Speed Work", description: "8x200m sprint intervals", isTemplate: true },
                { number: 9, title: "Peak Long Run", description: "Complete an 18K run", isTemplate: true },
                { number: 10, title: "Final Preparation", description: "10K run at race pace", isTemplate: true }
            ];

            await Task.insertMany(defaultTasks);
            console.log('Default tasks created');
        }

        // Get all tasks to verify
        const allTasks = await Task.find({ isTemplate: true });
        
        res.send(`
            <h1>Tasks Initialized</h1>
            <p>Number of tasks: ${allTasks.length}</p>
            <pre>${JSON.stringify(allTasks, null, 2)}</pre>
            <a href="/dashboard">Go to Dashboard</a>
        `);
    } catch (error) {
        console.error('Error initializing tasks:', error);
        res.status(500).send('Error initializing tasks');
    }
});

module.exports = Task;
// Add this route to verify MongoDB connection
app.get('/admin/check-db', isAdmin, async (req, res) => {
    try {
        // Check MongoDB connection
        const dbState = mongoose.connection.readyState;
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };
        
        // Test database operation
        const stats = await mongoose.connection.db.stats();
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Database Check</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-50 p-8">
                <div class="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-8">
                    <h1 class="text-2xl font-bold mb-4">Database Status</h1>
                    <div class="space-y-4">
                        <p><strong>Connection State:</strong> ${states[dbState]}</p>
                        <p><strong>Database Name:</strong> ${mongoose.connection.name}</p>
                        <p><strong>Collections:</strong> ${stats.collections}</p>
                        <p><strong>Total Documents:</strong> ${stats.objects}</p>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Database check error:', error);
        res.status(500).send('Error checking database: ' + error.message);
    }
});


// Now, let's create a detailed initialization route with proper error handling
app.get('/admin/initialize-tasks', isAdmin, async (req, res) => {
    try {
        console.log('Starting task initialization...');

        // First, clear existing tasks
        await Task.deleteMany({});
        console.log('Cleared existing tasks');

        // Create default tasks
        const defaultTasks = [
            { number: 1, title: "5K Training Run", description: "Complete a 5K training run at comfortable pace", isTemplate: true },
            { number: 2, title: "Interval Training", description: "Complete 6x400m interval training", isTemplate: true },
            { number: 3, title: "Long Run", description: "Complete a 10K long run", isTemplate: true },
            { number: 4, title: "Recovery Run", description: "30-minute easy recovery run", isTemplate: true },
            { number: 5, title: "Tempo Run", description: "25-minute tempo run at half marathon pace", isTemplate: true },
            { number: 6, title: "Hill Training", description: "Complete 6 hill repeats", isTemplate: true },
            { number: 7, title: "Distance Run", description: "Complete a 15K run", isTemplate: true },
            { number: 8, title: "Speed Work", description: "8x200m sprint intervals", isTemplate: true },
            { number: 9, title: "Peak Long Run", description: "Complete an 18K run", isTemplate: true },
            { number: 10, title: "Final Preparation", description: "10K run at race pace", isTemplate: true }
        ];

        console.log('Attempting to create tasks...');
        
        // Create tasks one by one with error handling
        for (const taskData of defaultTasks) {
            try {
                const task = new Task(taskData);
                await task.save();
                console.log(`Created task ${taskData.number}: ${taskData.title}`);
            } catch (err) {
                console.error(`Error creating task ${taskData.number}:`, err);
                throw err;
            }
        }

        // Verify tasks were created
        const allTasks = await Task.find({ isTemplate: true });
        console.log(`Successfully created ${allTasks.length} tasks`);

        // Send detailed response
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Tasks Initialization</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-50 p-8">
                <div class="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-8">
                    <h1 class="text-2xl font-bold mb-4">Tasks Initialization Status</h1>
                    <div class="mb-4">
                        <p class="text-lg">Number of tasks created: ${allTasks.length}</p>
                    </div>
                    <div class="mb-4">
                        <h2 class="text-xl font-semibold mb-2">Created Tasks:</h2>
                        <div class="space-y-2">
                            ${allTasks.map(task => `
                                <div class="p-2 border rounded">
                                    <p><strong>Task ${task.number}:</strong> ${task.title}</p>
                                    <p class="text-gray-600">${task.description}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="mt-6 flex space-x-4">
                        <a href="/dashboard" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            Go to Dashboard
                        </a>
                        <a href="/admin/dashboard" class="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">
                            Go to Admin Dashboard
                        </a>
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Task initialization error:', error);
        res.status(500).send(`
            <div class="bg-red-100 p-4 rounded">
                <h1 class="text-red-800 font-bold">Error Initializing Tasks</h1>
                <p class="text-red-700">${error.message}</p>
                <pre class="mt-4 bg-red-50 p-2 rounded">${error.stack}</pre>
            </div>
        `);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Google OAuth is configured with:');
    console.log(`Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not Set'}`);
    console.log(`Client Secret: ${process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not Set'}`);
    console.log(`Admin Emails: ${process.env.ADMIN_EMAILS || 'Not Set'}`);
});