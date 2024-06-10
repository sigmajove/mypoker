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
            socket.on("message", (msg) => {
                const element = document.getElementById("messages");
                element.textContent = msg;
                element.scrollTop = 25 * 25;
            });
            socket.on("update", (players) => updateTable(players));
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
            }).then(() => resolve(socketId));
        });
});

{
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
                    // the name request.
                    chooseName(disconnected);
                }
            });
    } else {
        // See if we can get the old name.
        getSocketId.then((socketId) => setName(oldName, socketId));
    }
}

function setName(player, socketId) {
    fetch(`${myURL}/setname`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            player: player,
            uuid: socketId
        })
    }).then(response => response.json())
        .then((response) => {
            const error = response.error;
            if (error !== undefined) {
                console.error(error);
            } else {
                let player = response.player;
                if (player !== undefined) {
                    document.getElementById("choosename").style.display =
                        "none";
                    setPageName(player, socketId);
                    sessionStorage.setItem("player", player);
                }
                let inuse = response.inuse;
                if (inuse !== undefined) {
                    document.getElementById("choosename").innerHTML =
                        `<div>The name ${player} is in use.</div>
Select a new name <input type="text" id="newplayer"><br>
<button onclick="namePlayer(true)">Submit</button>`;
                } else {
                    console.error("Unexpected response from /setname");
                    console.error(response);
                }
            }
        });
}

fetch(`${myURL}/disconnected`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    }
}).then(response => response.json())
    .then((response) => {
        const oldName = sessionStorage.getItem("player");
        const connected = response.connected;
        const disconnected = response.disconnected;
        if (oldName === null) {
            if (disconnected.length == 0) {
                nameInput();
            } else {
                // List all the disconnected players as part of
                // the name request.
                chooseName(disconnected);
            }
        } else {
            getSocketId.then((socketId) => setName(oldName, socketId));
        }
    });

function foundPlayer(player) {
    sessionStorage.setItem("player", player);
    document.getElementById("register").textContent = player;
    fetch(`${myURL}/sendmessage`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: `${player} has arrived`
        })
    });
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

function nameInput() {
    document.getElementById("choosename").innerHTML =
        `Select a name <input type="text" id="newplayer"><br>
<button onclick="namePlayer(true)">Submit</button>`;
}

async function namePlayer(retry) {
    const socketId = await getSocketId;
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
        setName(p, socketId).then(response => response.json())
            .then((response) => {
                let error = response.error;
                if (error !== undefined) {
                    console.error(error);
                    return;
                }
                let player = response.player;
                if (player !== undefined) {
                    document.getElementById("choosename").style.display =
                        "none";
                    setPageName(player, socketId);
                }
                let inuse = response.inuse;
                if (inuse !== undefined) {
                    document.getElementById("choosename").innerHTML =
                        `<div>The name ${p} is in use.</div>
Select a new name <input type="text" id="newplayer"><br>
<button onclick="namePlayer(true)">Submit</button>`;
                    return;
                }

            });
    };
}

function updateTable(players) {
    const table = document.getElementById("table");

    table.innerHTML =
        "<tr><th>Player</th><th>Score</th><th>Status</th></tr>";

    players.forEach((row) => {
        const tr = document.createElement("tr");
        let td = document.createElement("td");
        td.appendChild(document.createTextNode(row.player));
        tr.appendChild(td);

        td = document.createElement("td");
        td.appendChild(document.createTextNode(row.score));
        tr.appendChild(td);

        td = document.createElement("td");
        td.appendChild(document.createTextNode(""));  // For now
        tr.appendChild(td);

        table.appendChild(tr);
    });
}

function setPageName(me, uuid) {
    // Display uuid for debugging purposes.
    document.getElementById("register").textContent = `${me}: ${uuid}`;
}
