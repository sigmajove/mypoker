import express from 'express';
import {
    Server as socketIoServer
} from "socket.io";

import {
    createServer as httpCreateServer
} from "node:http";

import {
    Liquid
} from 'liquidjs';

const liquidEngine = new Liquid();

const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.urlencoded({
    extended: true
}));
expressApp.use(express.static('public'));
expressApp.engine('liquid', liquidEngine.express());
expressApp.set('views', './views');
expressApp.set('view engine', 'liquid')

const expressServer = httpCreateServer(expressApp);
const io = new socketIoServer(expressServer);

const port = process.env.PORT || 8080;

const eventHandlers = new Map([
    ["newGame", newGame],
    ["guess", guess],
]);

expressServer.listen(
    port,
    () => {
        const now = new Date();
        const pstNow = now.toLocaleString("en-US", {
            timeZone: "America/Los_Angeles"
        });
        console.log(`Server started at ${pstNow.toString()} (California time)`);
        console.log(`Server listening on ${port}`)
    });

expressApp.get('/', (req, res) => {
    res.render("client", {
        myurl: `${req.protocol}://${req.get('host')}`
    });
});

expressApp.get('/reset', (req, res) => {
    res.render("reset");
});

// I don't know how to hide this route from the browser.
// So I just gave it a wierd name.
expressApp.post("/ftkex0g3ouu39hiqj4tq", (req, res) => {
    io.emit("reload");
    initializeGame();
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

let idCounter = 0;
expressApp.post("/getid", (req, res) => {
    idCounter += 1;
    res.send({
        id: idCounter
    });
});


// A player is a object with the the following properties.
//   player: string  (Every player object has one)
//   score: number
//   uuid: string  (Only players in the game have one.)
//   socket: a socket.io socket  (Only players in the game have one.)

// The players, in the order in which they take turns.
// Conceptually, the order is circular.
let players;

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

function drawDealerButton(obj) {
    obj.socket.emit("game", `<p>Press to begin the next hand
<button onclick="theSocket.emit('newGame')">Deal</button></p>`);
}

const waitingMessage = "Waiting for the next hand to begin."

// Advances nextDealer to the next present player.
// Leaves nextDealer unchanged nextDealer is the only player present.
// Sets nextDealer to null if there are no players present.
function advanceNextDealer() {
    if (nextDealer === null) {
       return;
    }
    const j = players.findIndex((obj) => obj.player == nextDealer);
    if (j < 0) {
        throw new Error("nextDealer not found");
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

// Start sending messages to the socket.
expressApp.post("/enable", (req, res) => {
    const socketId = req.body.socketId;
    waitForSocket(socketId).then((socket) => {
        pendingSockets.delete(socketId);
        newSockets.set(socketId, socket);
        socket.emit("message", allMessages);
        socket.emit("update", playerState());
        res.send({});
    })
});

// Returns a list of players that have become disconnected.
expressApp.post("/disconnected", (req, res) => {
    res.send({
        disconnected: players.filter((obj) => obj.uuid === null)
            .map((obj) => obj.player)
    });
});

expressApp.post("/setname", (req, res) => {
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
        newSockets.delete(uuid);
        sendMessage(`${player} has joined the game.`);
        sendUpdate();
        if (guessMap !== null || nextDealer != player) {
            socket.emit("game", waitingMessage);
        }
        res.send({
            player: player
        });
        return;
    }
    if (obj.uuid === null) {
        // A player who left the game has returned.
        obj.uuid = uuid;
        obj.socket = socket;
        newSockets.delete(uuid);
        sendMessage(`${player} has returned to the game.`);
        if (nextDealer === null) {
            nextDealer = player;
            drawDealerButton(obj);
        } else {
            socket.emit("game", waitingMessage);
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

let allMessages;
initializeGame();

function initializeGame() {
    players = [];
    guessMap = null;
    nextDealer = null;
    allMessages = "The game server has been reset.\n";
}

const newlines = /\n/g;
const firstline = /.*\n/;

function sendMessage(message) {
    const matches = allMessages.match(newlines);
    if (matches !== null && matches.length >= 25) {
        allMessages = allMessages.replace(firstline, "");
    }
    allMessages = allMessages.concat(message, "\n");
    for (const socket of allSockets()) {
        socket.emit("message", allMessages);
    }
}

function playerState() {
    return players.filter((obj) => obj.uuid !== null).
        map((obj) => ({
            player: obj.player,
            score: obj.score,
            dealer: nextDealer !== null && nextDealer == obj.player
        }));
}

function sendUpdate() {
    const update = playerState();
    for (const socket of allSockets()) {
        socket.emit("update", update);
    }
}

io.on('connection', (socket) => {
    const socketId = socket.handshake.auth.socketId;
    socket.on('disconnect', () => {
        pendingSockets.delete(socketId);
        newSockets.delete(socketId);
        const obj = players.find((obj) => obj.uuid == socketId);
        if (obj !== undefined) {
            obj.uuid = null;
            delete obj.socket;
            if (obj.player == nextDealer) {
                advanceNextDealer();
            }
            if (guessMap !== null) {
                guessMap.delete(obj.player);
                checkGuesses();
            }
            sendMessage(`${obj.player} has left the game.`);
            sendUpdate();
        }
    });
    socket.onAny((eventName, ...args) => {
        const handler = eventHandlers.get(eventName);
        if (handler !== undefined) {
            handler.apply(null, args);
        }
    });

    // Save the newly created socket in newSockets.
    // It will be get transferred to players by /setname.
    pendingSockets.set(socketId, socket);
});

function newGame() {
    sendMessage("New round of guess the number");
    let gamers = players.filter((obj) => obj.uuid !== null);

    // Set a warning for players in the hand.
    // The refresh button will kick them out of the hand.
    for (const obj of gamers) {
      obj.socket.emit("setwarning");
    }
    guessMap = new Map;
    secretNumber = Math.floor(100 * Math.random());

    for (let i = 0; i < gamers.length; ++i) {
        let obj = gamers[i];
        guessMap.set(obj.player, null);
        obj.socket.emit("game", `There is a secret number from 0 to 99.<br>
The player(s) who guesses the closest without going over scores a point.<br>
<input type="number" id="guess" name="guess" size="2">
<button onclick="processGuess()">Submit</button>`);
    }
}

function guess(player, hisGuess) {
    guessMap.set(player, hisGuess);
    checkGuesses();
}

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
    sendMessage(`The secret number was ${secretNumber}`);
    if (bestGuess === null) {
        sendMessage("Everone guessed too high. Nobody got a point.");
    } else {
        guessMap.forEach((value, key) => {
            if (value == bestGuess) {
                sendMessage(
                    `${key} gets a point for guessing ${bestGuess}`);
                let j = players.findIndex((obj) => obj.player == key);
                if (j >= 0) {
                    players[j].score += 1;
                }
            }
        });
    };

    guessMap = null;
    advanceNextDealer();
    for (const obj of players) {
        if (obj.uuid !== null) {
            obj.socket.emit("clearwarning");
            if (obj.player != nextDealer) {
                obj.socket.emit("game", waitingMessage);
            }
        }
    }
    sendUpdate();
}
