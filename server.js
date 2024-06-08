if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const ExpressError = require('./utils/ExpressError');
const catchAsync = require('./utils/catchAsync');
const User = require('./models/user');
const express = require('express');
const path = require('path');
const ejsMate = require('ejs-mate');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const mongoSanitize = require('express-mongo-sanitize');
const { isLoggedIn} = require('./middleware');
const bodyParser = require('body-parser');
const mqtt = require('mqtt');
const MongoDBStore = require("connect-mongo");

const dbUrl = process.env.DB_URL;

mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

mongoose.set('strictQuery', true);

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
    console.log("db connected");
});

const app = express();

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(mongoSanitize({
    replaceWith: '_'
}));
app.use(bodyParser.json());
const secret = process.env.SECRET || 'thisshouldbeabettersecret!';

const store = MongoDBStore.create({
    mongoUrl: dbUrl,
    secret,
    touchAfter: 24 * 60 * 60
});


store.on("error", function (e) {
    console.log("SESSION STORE ERROR", e)
})

const sessionConfig = {
    store,
    name: 'session',
    secret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        // secure: true,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}


app.use(session(sessionConfig));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});


// MQTT broker configuration
const mqttServer = 'mqtt://server_IP:1883';

const mqttOptions = {
    username: 'server_project_name',
    password: 'project_password'
};

// Create MQTT client
const mqttClient = mqtt.connect(mqttServer, mqttOptions);

mqttClient.on('connect', function () {
    console.log('Connected to MQTT broker');
});

mqttClient.on('error', function (error) {
    console.error('Error connecting to MQTT broker:', error);
});

function keepLight(mqttClient) {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user._id);
            const container = user.container;

            for (let btn of container) {
                const mqttMessage = btn.style.light ? `{${btn.title}: "on"}` : `{${btn.title}: "off"}`;
                mqttClient.publish('ttpu/inside', mqttMessage);
                console.log(`Published MQTT message: ${mqttMessage}`);
                
            }
        } catch (error) {
            console.error('Error in keepLight middleware:', error);
            return res.status(500).send('Internal Server Error');
        }
        next();
    };
}

async function scheduler(mqttClient,hour,min) {
    try {
        const users = await User.find(); // Adjust the query if needed
        for (let user of users) {
            const container = user.container;

            for (let btn of container) {
                const dbHourStart=parseInt(btn.start.slice(0,2) )*100
                const dbMinStart=parseInt(btn.start.slice(3,5) )
                const dbHourEnd=parseInt(btn.end.slice(0,2) )*100
                const dbMinEnd=parseInt(btn.end.slice(3,5) )

                if(btn.userChange){
                    if( ( dbHourStart+dbMinStart ) < ( hour*100+min ) && ( dbHourEnd+dbMinEnd < (hour*100+min ) ) ){
                        console.log('starttrrtrt')
                        console.log(parseInt(btn.start.slice(0,2) )*100+parseInt(btn.start.slice(3,5) ))
                        console.log(parseInt(hour)*100+parseInt(min))
                        const mqttMessage = `{${btn.title}: "on"}`
                        mqttClient.publish('ttpu/allTopic', mqttMessage);
                        console.log(`From timer Published MQTT message: ${mqttMessage}`);
                    }else{
                        const mqttMessage = `{${btn.title}: "off"}`
                        mqttClient.publish('ttpu/allTopic', mqttMessage);
                        console.log(`From timer Published MQTT message: ${mqttMessage}`);   
                    }
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
}

function keepschedule(mqttClient) {
    setInterval(async () => {
        const currentTime = new Date();
        const adjustedTime = new Date(currentTime.getTime());
        const hour = adjustedTime.getHours();
        const minute = adjustedTime.getMinutes();
        const formattedHour = (hour < 10 ? '0' : '') + hour;
        const formattedMinute = (minute < 10 ? '0' : '') + minute;

        scheduler(mqttClient,parseInt(hour),parseInt(min))
    },5*1000 ); 
}

// Start the schedulert function to run every 2 minutes
keepschedule(mqttClient);

app.get('/', (req, res) => {
    res.render('home');
});

app.post('/',passport.authenticate('local', { failureFlash: true, failureRedirect: '/' }), async (req, res) => {
    req.flash('success', 'welcome back!');
    const redirectUrl = req.session.returnTo || '/test1';
    delete req.session.returnTo;
    res.redirect(redirectUrl);
});

app.get('/signup', (req, res) => {
    res.render('register');
});

app.post('/register', catchAsync(async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const buttons = [];
        const container = [{
            title: '',
            start: '',
            end: '',
            style: {
                top: '',
                left: '',
                width: '',
                height: '',
                class: '',
                light: false,
                userChange:false
            }
        }];
        const user = new User({ username, buttons, container });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to Yelp Camp!');
            res.redirect('/test1');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
}));

app.get('/logout',logout = (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/');
    });
})

app.get('/test1',isLoggedIn,(req,res)=>{
    res.render('test1')
})

app.post('/test1', isLoggedIn, async (req, res) => {
    try {
        const containerData = req.body.container; // Extract container data from request body
        await User.findByIdAndUpdate(req.user._id, { container: containerData }, { overwrite: true });
        console.log('newwwww')
        console.log(containerData)
        res.redirect('/test2');
    } catch (error) {
        console.error('Error saving container data:', error);
        res.status(500).send('Failed to save container data');
    }
});

app.get('/test2', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const container = user.container;
        res.render('test2', { username:user.username ,container:container });
    } catch (error) {
        console.error('Error fetching container data:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/test2', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const { oldTitle, newTitle, startTime, endTime } = req.body;
        const buttonIndex = user.container.findIndex(button => button.title === oldTitle);
        if (buttonIndex !== -1) {
            user.container[buttonIndex].title = newTitle;
            user.container[buttonIndex].start= startTime;
            user.container[buttonIndex].end= endTime;
            await user.save();
            //res.json({ status: 'success', oldTitle, newTitle });
            res.redirect('/test2')
        } else {
            res.status(404).json({ status: 'error', message: 'Button not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

app.get('/controlPage',isLoggedIn,keepLight(mqttClient), async (req,res)=>{
    try{
        console.log('used')
        
        const user = await User.findById(req.user._id);
        res.render('try',{ username:user.username ,container:user.container })
    }catch (error){
        console.log(error)
    }
})

app.post('/controlPage', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).send('User not found');
        }

        const { title } = req.body;
        const buttonIndex = user.container.findIndex(button => button.title === title);
        if (buttonIndex !== -1) {
            user.container[buttonIndex].style.light = !user.container[buttonIndex].style.light;
            await user.save();
        } else {
            return res.status(404).send('Button not found');
        }

        res.json({ message: 'Button updated successfully' });
    } catch (error) {
        console.log('Error updating button:', error);
        res.status(500).send("Internal Server Error");
    }
});

// Your other routes and middleware...
app.all('*', (req, res, next) => {
    next(new ExpressError('Page Not Found', 404));
});

app.use((err, req, res, next) => {
    const { statusCode = 500 } = err;
    if (!err.message) err.message = 'Oh No, Something Went Wrong!';
    res.status(statusCode).render('error', { err });
});

app.listen(5000, () => {
    console.log('Server is running on http://localhost:5000');
});
