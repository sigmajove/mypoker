import express from "express";
import admin from "firebase-admin";
import {
    Liquid
} from "liquidjs";
import http from "http";
import https from "https";
import {
    Server as socketIoServer
} from "socket.io";
import * as fs from "fs";

const liquidEngine = new Liquid();

const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.urlencoded({
    extended: true
}));
expressApp.use(express.static("public"));
expressApp.engine("liquid", liquidEngine.express());
expressApp.set("views", "./views");
expressApp.set("view engine", "liquid")

let expressServer;
let port;
// If there are certficates use https, otherwise use http.
if (fs.existsSync("certificate.pem") &&
    fs.existsSync("certificate-chain.pem")) {
    expressServer = https.createServer({
            key: fs.readFileSync("certificate.pem"),
            cert: readFileSync("certificate-chain.pem")
        },
        expressApp);
    port = 443;
} else {
    expressServer = http.createServer(expressApp);
    port = 80;
}
const io = new socketIoServer(expressServer);


// Connect to Firebase.
// We save the players and their scores after every game so that
// we don't lose them them if the server crashes.
const credentials = new Promise((resolve) => {
    fs.readFile("firebase-credentials.json", "utf8", (error, data) => {
        if (error) {
            throw error;
        }
        resolve(data);
    });
});
admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(await credentials))
});
const firestoreDb = admin.firestore();

// We could in principle run multiple game servers concurrently. 
// Each server would get its own doc. But for now, the only server
// runs on Oracle Cloud.
const docRef = firestoreDb.collection("only").doc("oracle");

// Write out the player information to Firebase.
// We could also save the current dealer. But restoring it would be
// awkward. What happens if the dealer doesn't come back after the crash?
// The simple solution to have the first player that arrives be the next
// dealer, whether we are starting from a clean slate or recovering from
// a crash.
async function snapshotPlayers() {
    const snapshot = {
        players: players.map((obj) => {
            return {
                player: obj.player,
                score: obj.score
            };
        })
    };
    await docRef.set(snapshot);
}

// Initialize the players array by reading Firebase.
async function readPlayers() {
    players = [];
    const snapshot = await docRef.get();
    if (snapshot.exists) {
        const p = snapshot.data().players;
        if (p) {
            for (let {
                    player,
                    score
                }
                of p) {
                players.push({
                    player: player,
                    score: score,
                    uuid: null
                });
            }
        }
    }
}

// There is a handler for each message that can be sent over a socket.
const eventHandlers = new Map([
    ["newGame", newGame],
    ["guess", guess],
]);


// Define the routes for the http server.
expressApp.get('/', (req, res) => {
    res.render('client', {
        myurl: `${req.protocol}://${req.get('host')}`
    });
});

expressApp.get('/reset', (req, res) => {
    res.render('reset');
});

expressApp.get('/crash', (req, res) => {
    res.send(`<html>
<head>
<meta http-equiv="refresh"
           content="3; url=${req.protocol}://${req.get('host')}/" />
</head>
<body>
The server will crash for testing purposes.
</body>
</html>`);
    setTimeout(() => {
            console.log("Server crashed for testing purposes");
            process.exit(1);
        },
        7000);
});

// Define all the endpoints for the RESTful API.

// A source of unique socket ids.
let idCounter = 0;
expressApp.post('/getid', (req, res) => {
    idCounter += 1;
    res.send({
        id: idCounter
    });
});

// Start sending messages to the socket.
expressApp.post('/enable', (req, res) => {
    const socketId = req.body.socketId;
    waitForSocket(socketId).then((socket) => {
        pendingSockets.delete(socketId);
        newSockets.set(socketId, socket);
        socket.emit('message', allMessages);
        socket.emit('update', playerState());
        res.send({});
    })
});

// Returns a list of players that have become disconnected.
expressApp.post('/disconnected', (req, res) => {
    res.send({
        disconnected: players.filter(
            (obj) => obj.uuid === null).map((obj) => obj.player)
    });
});

// Attempts to associate a player with a socket id.
// May fail of a player with that name already exists.
expressApp.post('/setname', (req, res) => {
    const uuid = req.body.uuid;
    const player = req.body.player;
    const socket = newSockets.get(uuid);

    if (socket === undefined) {
        const errorMessage = `Missing socket id ${uuid}`;
        console.error(errorMessage);
        res.send({
            error: errorMessage
        });
        return;
    }

    // See if there is already a slot for the player.
    const obj = players.find((obj) => obj.player == player);
    if (obj === undefined) {
        // Create a new slot for the player.
        // Move the uuid from newSockets to the player array.
        newSockets.delete(uuid);
        players.push({
            player: player,
            score: 0,
            uuid: uuid,
            socket: socket
        });
        if (nextDealer === null) {
            nextDealer = player;
            if (guessMap === null) {
                drawDealerButton(players[players.length - 1]);
            }
        }
        sendMessage(`${player} has joined the game.`);
        sendUpdate();
        if (guessMap !== null || nextDealer != player) {
            socket.emit('game', waitingMessage);
        }
        res.send({
            player: player
        });
        return;
    }
    if (obj.uuid === null) {
        // A player who left the game has returned.
        // Move the uuid from newSockets to the existing slot
        // in the player array.
        obj.uuid = uuid;
        obj.socket = socket;
        newSockets.delete(uuid);

        sendMessage(`${player} has returned to the game.`);
        if (nextDealer === null) {
            nextDealer = player;
            drawDealerButton(obj);
        } else {
            socket.emit('game', waitingMessage);
        }
        sendUpdate();
        res.send({
            player: player
        });
    } else {
        // The requested name is being used by somebody else.
        // The requester needs to pick new name.
        res.send({
            inuse: player
        })
    }
});

// Destroys all the game state; starts over with a clean slate.
// I don't know how to hide this route from the browser.
// So I just gave it a weird name.
expressApp.post('/ftkex0g3ouu39hiqj4tq', (req, res) => {
    docRef.delete().then(() => {
        players = [];
        initializeGame();
        io.emit('reload');
        res.send(`<html>
<head>
<meta http-equiv="refresh"
           content="3; url=${req.protocol}://${req.get('host')}/" />
</head>
<body>
The game has been reset. Redirecting...
</body>
</html>`);
    });
});

function restartMessage() {
    const now = new Date();
    const pstNow = now.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles'
    });
    return `Server started at ${pstNow.toString()} (California time).`;
}

// Launch the HTTP server.
expressServer.listen(port, () => {
    const now = new Date();
    const pstNow = now.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles'
    });
    console.log(restartMessage());
    console.log(`Server listening on port ${port}`);
});

// The global state for the server.
// Which is why we need a server and not a PaaS.

// The players, in the order in which they take turns.
// Conceptually, the order is circular.
let players;

// A player is a object with the the following properties.
//   player: string  (Every player object has a name.)
//   score: number   (Starts out at zero.)
//   uuid: number or null  (Only players in the game have one.)
//   socket: a socket.io socket  (Only players in the game have one.)

// Global state for the guess-the-number game.
// These should probably be collected into an object.
let guessMap = null;
let secretNumber;

// The name of the next dealer or null if none is assigned.
let nextDealer;

// When a socket is first created, we have its uuid but it is not yet
// associated with a player.  It might not yet have listeners attached.
// We save the socket in this map.
const pendingSockets = new Map();

// Once the client has attached all the listeners to the socket,
// it calls /enable. This post causes the socket to be moved from
// pendingSockets to newSockets, and messages to be sent on the new
// socket to initialize the client's screen. The socket is still
// not associated with a user.
const newSockets = new Map();

// Next the client comes up with a proposed name, either from the UI
// or session storage, and calls /setname. The catch is, given potential
// races, we cannot be sure if the name is available. /setname can repeatedly
// fail and needs to be recalled with a different name. When /setname succeeds,
// it takes the socket out of newSockets and installs it in players with the
// player name and uuid.

// A generator that allows iterating over all sockets with listeners.
function* allSockets() {
    for (const socket of newSockets.values()) {
        yield socket;
    }
    for (const obj of players) {
        if (obj.socket !== undefined) {
            yield obj.socket;
        }
    }
}

// Creates a dealer button in the UI.
// Must be called when nextDealer changes.
function drawDealerButton(obj) {
    obj.socket.emit('game', `<p>Press to begin the next hand
<button onclick="theSocket.emit('newGame')">Deal</button></p>`);
}

// Advances nextDealer to the next present player.
// Leaves nextDealer unchanged nextDealer is the only player present.
// Sets nextDealer to null if there are no players present.
function advanceNextDealer() {
    if (nextDealer === null) {
        return;
    }
    const j = players.findIndex((obj) => obj.player == nextDealer);
    if (j < 0) {
        throw new Error('nextDealer not found');
    }
    let iter = j;
    for (;;) {
        iter += 1;
        if (iter >= players.length) {
            iter = 0;
        }
        const obj = players[iter];
        if (obj.uuid !== null) {
            nextDealer = obj.player;
            if (guessMap === null) {
                drawDealerButton(obj);
            }
            return;
        }
        if (iter == j) {
            nextDealer = null;
            return;
        }
    }
}

// Wait for a socket with the given id to show in pendingSockets.
function waitForSocket(socketId) {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            let socket = pendingSockets.get(socketId);
            if (socket !== undefined) {
                clearInterval(timer);
                resolve(socket);
            }
        }, 30);
    });
}

// allMessages is the contents of each player's message window.
let allMessages;

initializeGame();
await readPlayers();

function initializeGame() {
    nextDealer = null;
    guessMap = null;
    allMessages = `${restartMessage()}\n`;
}

const newlines = /\n/g;
const firstline = /.*\n/;
const waitingMessage = "Waiting for the next hand to begin.";

// Appends a message to AllMessages, keeping at most 25 messages.
function sendMessage(message) {
    const matches = allMessages.match(newlines);
    if (matches !== null && matches.length >= 25) {
        allMessages = allMessages.replace(firstline, '');
    }
    allMessages = allMessages.concat(message, '\n');

    // Update the message window of every socket with listeners.
    for (const socket of allSockets()) {
        socket.emit('message', allMessages);
    }
}

// The contents of each player's player data window.
function playerState() {
    return players.filter((obj) => obj.uuid !== null)
        .map((obj) => ({
            player: obj.player,
            score: obj.score,
            dealer: nextDealer !== null && nextDealer == obj.player
        }));
}

function sendUpdate() {
    const update = playerState();

    // Update the player data window of every socket with listeners.
    for (const socket of allSockets()) {
        socket.emit('update', update);
    }
}

// The code that manages socket connects and disconnects.
io.on('connection', (socket) => {
    const socketId = socket.handshake.auth.socketId;
    socket.on('disconnect', () => {
        // Remove all references to the disconnected socket.
        pendingSockets.delete(socketId);
        newSockets.delete(socketId);
        const obj = players.find((obj) => obj.uuid == socketId);
        if (obj !== undefined) {
            obj.uuid = null;
            delete obj.socket;

            // If the departing player is nextDealer, pick somebody
            // else.
            if (obj.player == nextDealer) {
                advanceNextDealer();
            }

            // If the departing player is in a round of a game,
            // drop him from the game.
            if (guessMap !== null) {
                guessMap.delete(obj.player);
                checkGuesses();
            }

            // Notify the players of the change.
            sendMessage(`${obj.player} has left the game.`);
            sendUpdate();
        }
    });

    // Generic code for listening to messages sent to the new socket.
    socket.onAny((eventName, ...args) => {
        const handler = eventHandlers.get(eventName);
        if (handler !== undefined) {
            handler.apply(null, args);
        }
    });

    // Save the newly created socket in pendingSockets.
    // It will be get transferred newSockets in /enable.
    pendingSockets.set(socketId, socket);
});

// Handler for the "newGame" message.
// Starts up a round of the guess-the-number game.
function newGame() {
    sendMessage('New round of guess the number');
    let gamers = players.filter((obj) => obj.uuid !== null);

    // Set a warning for players in the hand.
    // The refresh button will kick them out of the hand.
    for (const obj of gamers) {
        obj.socket.emit('setwarning');
    }
    guessMap = new Map;
    secretNumber = Math.floor(100 * Math.random());

    for (const obj of gamers) {
        guessMap.set(obj.player, null);
        obj.socket.emit('game', `There is a secret number from 0 to 99.<br>
The player(s) who guesses the closest without going over scores a point.<br>
<input type="number" id="guess" name="guess" size="2">
<button onclick="processGuess()">Submit</button>`);
    }
}

// Handler for the "guess" message.
// Records the guess of a player.
function guess(player, hisGuess) {
    guessMap.set(player, hisGuess);
    checkGuesses();
}

// Needs to be called whenever guessMap changes.
// Checks if the game is over, and if so, picks a winner.
function checkGuesses() {
    let allGuessed = true;
    let bestGuess = null;
    guessMap.forEach((value) => {
        if (value === null) {
            allGuessed = false;
        }
        if (value <= secretNumber) {
            if (bestGuess === null || value > bestGuess) {
                bestGuess = value;
            }
        }
    });
    if (!allGuessed) {
        return;
    }

    // This round of the game is over.
    sendMessage(`The secret number was ${secretNumber}`);
    if (bestGuess === null) {
        sendMessage('Everone guessed too high. Nobody got a point.');
        // (Or everyone dropped out without guessing.)
    } else {
        guessMap.forEach((value, key) => {
            if (value == bestGuess) {
                sendMessage(`${key} gets a point for guessing ${bestGuess}`);
                let j = players.findIndex((obj) => obj.player == key);
                if (j >= 0) {
                    players[j].score += 1;
                }
            }
        });
    };

    // Prepare for the next game.
    guessMap = null;
    advanceNextDealer();
    snapshotPlayers();
    for (const obj of players) {
        if (obj.uuid !== null) {
            obj.socket.emit('clearwarning');
            if (obj.player != nextDealer) {
                obj.socket.emit('game', waitingMessage);
            }
        }
    }
    sendUpdate();
}
