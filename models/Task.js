// First, let's verify our Task model (models/Task.js)
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    isTemplate: {
        type: Boolean,
        default: true
    },
    userTasks: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        completed: {
            type: Boolean,
            default: false
        },
        screenshotUrl: String,
        completedAt: Date,
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        },
        feedback: String
    }]
});