let theSocket;
let myName;

const getSocketId = new Promise((resolve) => {
    fetch(`${myURL}/getid`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            }
        }).then(response => response.json())
        .then((response) => {
            const socketId = response.id;
            const socket = io({
                auth: {
                    socketId: socketId,
                    player: sessionStorage.getItem("player")
                }
            });
            theSocket = socket;
            socket.on("message", (msg) => {
                const element = document.getElementById("messages");
                element.textContent = msg;
                element.scrollTop = 25 * 25;
            });
            socket.on("update", (players) => updateTable(players));
            socket.on("game", (html) => {
                document.getElementById("gameWindow").innerHTML = html;
            });
            socket.on("connect_error", (err) => {
                console.error(`connect_error due to ${err.message}`);
            });

            fetch(`${myURL}/enable`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    socketId: socketId
                })
            }).then(() => {
                const oldName = sessionStorage.getItem("player");
                if (oldName === null) {
                    fetch(`${myURL}/disconnected`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            }
                        }).then(response => response.json())
                        .then((response) => {
                            const disconnected = response.disconnected;
                            if (disconnected.length == 0) {
                                nameInput();
                            } else {
                                // List all the disconnected players as part of
                                // the name input menu.
                                chooseName(disconnected);
                            }
                        });
                } else {
                    // See if we can get the old name.
                    setName(oldName, socketId);
                }
                resolve(socketId);
            });
        });
});

async function setName(player, socketId) {
    var response = await fetch(`${myURL}/setname`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            player: player,
            uuid: socketId
        })
    });
    response = await response.json();
    {
        const error = response.error;
        if (error !== undefined) {
            console.error(error);
            return;
        }
    } {
        const player = response.player;
        if (player !== undefined) {
            document.getElementById("choosename").style.display =
                "none";
            document.title = player;
            document.getElementById("register").textContent = player;
            sessionStorage.setItem("player", player);
            myName = player;
            return;
        }
    } {
        const inuse = response.inuse;
        if (inuse !== undefined) {
            document.getElementById("choosename").innerHTML =
                `<div>The name ${player} is in use.</div>
Select a new name <input type="text" id="newplayer"><br>`;
            detectReturn();
            return;
        }
    }
    console.error("Unexpected response from /setname");
    console.error(response);
}

// Outputs a menu for selecting a name, including radio buttons
// for all the disconnected players.
function chooseName(disconnected) {
    let html = ["<div><br>Select a player name:</div>"];
    disconnected.forEach((name) => {
        html.push(
            `<input type="radio" name="player", value="${name}">${name}<br>`);
    });
    html.push(
        `<input type="radio" name="player", value="" checked>New Player
<input type="text" id="newplayer"><br>
<button onclick="namePlayer(false)">Submit</button>`);
    document.getElementById("choosename").innerHTML = html.join("");
}

function detectReturn() {
    document.getElementById("newplayer").addEventListener("keyup",
        ({key}) => {
            console.log("Listener", key);
            if (key === "Enter") {
                namePlayer(true);
            }
        });
}

function nameInput() {
    document.getElementById("choosename").innerHTML =
        `Select a name <input type="text" id="newplayer">`;
    detectReturn();
}

async function namePlayer(retry) {
    let p;
    if (retry) {
        p = document.getElementById("newplayer").value.trim();
    } else {
        p = document.querySelector("input[name=player]:checked").value;
        if (p == "") {
            p = document.getElementById("newplayer").value.trim();
        }
    }
    if (p != "") {
        setName(p, await getSocketId);
    }
}

function updateTable(players) {
    const table = document.getElementById("table");

    table.innerHTML =
        `<tr><th style="text-align:left;">Player</th>
<th>Score</th><th>Status</th></tr>`;

    players.forEach((row) => {
        const tr = document.createElement("tr");
        let td = document.createElement("td");
        td.appendChild(document.createTextNode(row.player));
        tr.appendChild(td);

        td = document.createElement("td");
        td.style = "padding-left:15px;"
        td.appendChild(document.createTextNode(row.score));
        tr.appendChild(td);

        td = document.createElement("td");
        td.appendChild(document.createTextNode(
            row.dealer ? "dealer" : ""
        ));
        tr.appendChild(td);

        table.appendChild(tr);
    });
}

function processGuess() {
    const guess = document.getElementById("guess");
    const value = guess.value;
    if (value.length > 0) {
        const number = Number(value);
        if (number >= 0 && number <= 99) {
            theSocket.emit("guess", myName, number);
            document.getElementById("gameWindow").innerHTML =
                "Waiting for all players to guess";
            return;
        }
    }
    guess.value = "";
}
