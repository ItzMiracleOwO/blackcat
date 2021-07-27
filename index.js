require("dotenv").config();

const
  Discord = require("discord.js"),
  mongo = require("quickmongo"),
  fetch = require("node-fetch"),
  express = require("express"),
  lyricsFinder = require("lyrics-finder"),
  ws = require("express-ws"),
  crypto = require("crypto"),
  helmet = require("helmet"),
  io = require("@pm2/io"),
  SoundCloud = require("soundcloud-scraper"),
  RateLimit = require("express-rate-limit"),
  { readdirSync } = require("fs"),
  { DiscordTogether } = require("discord-together"),
  { join } = require("path")

const PREFIX = process.env.PREFIX;
let bootStart = Date.now();

const client = new Discord.Client({
  allowedMentions: { parse: ["users", "roles"], repliedUser: true },
  restTimeOffset: 0,
  disableMentions: "everyone",
  presence: {
    status: "dnd",
    activity: {
      name: "啟動中..."
    }
  }
});
const db = new mongo.Database(process.env.MONGO_DB_URL, "blackcat");
require("discord-buttons")(client);
global.fetch = require("node-fetch");
client.login(process.env.TOKEN);
client.together = new DiscordTogether(client);
client.db = db;
client.commands = new Discord.Collection();
client.prefix = PREFIX;
client.queue = new Map();
client.log = async function(message, msgContent, system, type) {
  const webhook = new Discord.WebhookClient(process.env.WEBHOOK_ID, process.env.WEBHOOK_SECRET);
  let content = null;
  if (system) {
    content = `(Black cat)[System] ${msgContent}`;
  } else {
    content = `(Black cat)[${message.guild.name}(${message.guild.id})]/${message.author.username} ${msgContent}`;
  }
  switch (type) {
    case "info":
      webhook.send(content, {
        username: "Black cat log [Info]",
        avatarURL: "https://blackcatbot.tk/info.png"
      });
      break;
    case "warn":
      webhook.send(content, {
        username: "Black cat log [Warn]",
        avatarURL: "https://blackcatbot.tk/warn.png"
      });
      break;
    case "error":
      webhook.send(content, {
        username: "Black cat log [Error]",
        avatarURL: "https://blackcatbot.tk/error.png"
      });
      break;
    default:
      webhook.send(content, {
        username: "Black cat log [Info]",
        avatarURL: "https://blackcatbot.tk/info.png"
      });
      break;
  }
};

const app = express()
const limiter = RateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: "429 Too many requests",
  onLimitReached: function(req) {
    client.log(null, `${req.headers['x-forwarded-for']} has been rate-limited`);
  }
});
app.set("trust proxy", true);
ws(app);
app.use(helmet());
app.use(limiter);
app.use(express.json());

const cooldowns = new Discord.Collection();

SoundCloud.keygen()
  .then(key => {
    client.scKey = key;
    client.log(null, `Fetched SoundCloud key \`${key}\``, true, "info")
  })
  .catch(console.error);

client.on("ready", async () => {
  console.log(`Logged as ${client.user.username}`);
  console.log(`Bot is in ${client.guilds.cache.size} server(s)`);
  client.log(null, `Black cat ready, boot took ${Date.now() - bootStart}ms`, true, "info");
  delete bootStart;
  client.log(null, `Using FFmpeg engine \`${require("prism-media").FFmpeg.getInfo().version}\``, true, "info");
  client.user.setPresence({ activity: { name: `b.help | ${client.guilds.cache.size}個伺服器`, type: "STREAMING", url: "https://youtube.com/watch?v=lK-i-Ak0EAE" }, status: "dnd" });
});

db.on("ready", () => {
  console.log("Connected to DB");
  client.log(null, "connected to DB", true, "info");
});

client.on("warn", (info) => console.log(info));
client.on("error", console.error);

const commandFiles = readdirSync(join(__dirname, "commands")).filter((file) => file.endsWith(".js"));
console.log("Loading all commands...");
for (const file of commandFiles) {
  const command = require(join(__dirname, "commands", `${file}`));
  client.commands.set(command.name, command);
}
console.log("All commands are loaded.");

client.on("message", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (!(message.content.startsWith(PREFIX) || message.content.startsWith(PREFIX.toUpperCase()))) return;

  const args = message.content.slice(PREFIX.length).trim().split(" ");
  const commandName = args.shift().toLowerCase();

  const command =
    client.commands.get(commandName) ||
    client.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));

  if (!command) return;

  if (!cooldowns.has(command.name)) {
    cooldowns.set(command.name, new Discord.Collection());
  }

  const now = Date.now();
  const timestamps = cooldowns.get(command.name);
  const cooldownAmount = (command.cooldown || 1) * 1000;

  if (timestamps.has(message.author.id)) {
    const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return message.channel.send(`🕒 ┃ 請等待${Math.ceil(timeLeft.toFixed(1))}秒後再使用${command.name}指令!!!`);
    }
  }

  timestamps.set(message.author.id, now);
  setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

  message.slash = {};

  try {
    command.execute(message, args);
  } catch (error) {
    console.error(error);
    message.channel.send(`❌ ┃ 執行時出現錯誤:${error.message}`).catch(console.error);
    message.client.log(message, `${error.message} (Command:${command.name})`, false, "error");
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (!oldState.channelID && newState.channelID) return;
    if (!oldState.guild || !newState.guild) return;
    const queue = client.queue.get(oldState.guild.id);
    if (!queue) return;
    if (!queue.connection) return;
    if (!queue.connection.dispatcher) return;
    if (!queue.songs.length || queue.songs.length === 0) return;
    if (queue.connection.channel.members.filter(user => !user.bot).size <= 1) {
      setTimeout(function() {
        if (queue.connection.channel.members.filter(user => !user.bot).size <= 1) {
          queue.textChannel.send("🎈 ┃ 因為頻道裡面已經沒人了，所以我離開了語音頻道").catch(console.error);
          queue.songs = [];
          try {
            queue.connection.dispatcher.end();
          } catch (e) {
            console.log(e.message);
          }
        }
      }, 15000);
    }
  } catch (error) {
    console.log(error);
  }
});

client.on("guildCreate", async guild => {
  client.user.setPresence({ activity: { name: `b.help | ${client.guilds.cache.size}個伺服器`, type: "STREAMING", url: "https://youtube.com/watch?v=lK-i-Ak0EAE" }, status: "dnd" });
  if (!guild.systemChannel) return;
  const embed = new Discord.MessageEmbed()
    .setTitle("感謝邀請Black cat")
    .setDescription(
      "非常謝謝你邀請我進來這個伺服器!**OWO**\n\n" +
      "[加入官方Discord伺服器](https://blackcatbot.tk/blackcat)\n" +
      "我們強烈建議您加入我們的Discord伺服器，以便接受通知\n\n" +
      "想要開始探索嗎?輸入`b.help`吧!\n" +
      "發生問題?輸入`b.support`!")
    .setColor("#5865F2")
    .setFooter("注意:斜線指令僅支援音樂指令以及部分其他指令")
    .setFooter("By lollipop dev team");
  guild.systemChannel.send(embed);
  client.log(null, `Joined ${guild.name}`, true, "info");
});

client.on("guildDelete", guild => {
  client.user.setPresence({ activity: { name: `b.help | ${client.guilds.cache.size}個伺服器`, type: "STREAMING", url: "https://youtube.com/watch?v=lK-i-Ak0EAE" }, status: "dnd" });
  client.log(null, `Leave ${guild.name}`, true, "info");
});

client.ws.on("INTERACTION_CREATE", async int => {
  if (int.type !== 2) return;

  let guild = await client.guilds.fetch(int.guild_id).catch(error => {
    console.log(error);
    return client.api.interactions(int.id, int.token).callback.post({
      data: {
        type: 4,
        data: {
          content: "請在伺服器中執行指令!",
          flags: 64
        }
      }
    });
  });
  let channel = guild.channels.cache.get(int.channel_id);
  if (!channel) return client.api.interactions(int.id, int.token).callback.post({
    data: {
      type: 4,
      data: {
        content: "請邀請機器人!Black cat需要邀請機器人後才可以使用斜線指令!",
        flags: 64
      }
    }
  });
  let member = await guild.members.fetch(int.member.user.id).catch(error => {
    console.log(error);
    return client.api.interactions(int.id, int.token).callback.post({
      data: {
        type: 4,
        data: {
          content: "請在伺服器中執行指令!",
          flags: 64
        }
      }
    });
  });
  let author = member.user;
  let createdTimestamp = Date.now();
  const message = {
    channel,
    guild,
    author,
    client,
    content: null,
    member,
    createdTimestamp,
    slash: {
      send: function(content) {
        client.api.interactions(int.id, int.token).callback.post({
          data: {
            type: 4,
            data: {
              content: content
            }
          }
        }).catch(console.error);
      },
      sendEmbed: function(embed) {
        client.api.interactions(int.id, int.token).callback.post({
          data: {
            type: 4,
            data: {
              embeds: [embed]
            }
          }
        }).catch(console.error);
      },
      edit: function(content) {
        client.api.webhooks(client.user.id, int.token).messages("@original").patch({
          data: {
            content: content
          }
        }).catch(console.error);
      },
      editEmbed: function(embed) {
        client.api.webhooks(client.user.id, int.token).messages("@original").patch({
          data: {
            embeds: [embed]
          }
        }).catch(console.error);
      },
      delete: function() {
        client.api.webhooks(client.user.id, int.token).messages("@original").delete().catch(console.error);
      },
      raw: int
    }
  };

  try {
    if (!int.guild_id) return client.api.interactions(int.id, int.token).callback.post({
      data: {
        type: 4,
        data: {
          content: "請在伺服器中執行指令!",
          flags: 64
        }
      }
    });
    else if (!message.channel.permissionsFor("848006097197334568").has("SEND_MESSAGES")) return client.api.interactions(int.id, int.token).callback.post({
      data: {
        type: 4,
        data: {
          content: "沒有權限在此頻道發送訊息!",
          flags: 64
        }
      }
    });
  } catch (e) {
    console.log(e.message);
  }

  let args = [];
  if (int.data.options) {
    const contents = [];
    int.data.options.forEach(arg => {
      contents.push(arg.value);
    });
    message.content = `b.${int.data.name} ${contents.join(" ")}`;
    args = contents;
  }

  const commandName = int.data.name.toLowerCase();

  const command =
    client.commands.get(commandName) ||
    client.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));

  if (!command) return;

  if (!cooldowns.has(command.name)) {
    cooldowns.set(command.name, new Discord.Collection());
  }

  const now = Date.now();
  const timestamps = cooldowns.get(command.name);
  const cooldownAmount = (command.cooldown || 1) * 1000;

  if (timestamps.has(message.author.id)) {
    const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return message.channel.send(`🕒 請等待${Math.ceil(timeLeft.toFixed(1))}秒後再使用${command.name}指令!!!`);
    }
  }

  timestamps.set(message.author.id, now);
  setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

  if (!command.slashReply) await client.api.interactions(int.id, int.token).callback.post({
    data: {
      type: 4,
      data: {
        content: "正在處理..."
      }
    }
  });

  try {
    command.execute(message, args);
  } catch (error) {
    console.error(error);
    message.channel.send(`❌ ┃ 執行時出現錯誤:${error.message}`).catch(console.error);
    message.client.log(message, `${error.message} (Command:${command.name})`, false, "error");
  }
});

app.get("", (req, res) => {
  res.sendFile(join(__dirname, "static", "index.html"))
})

app.ws("/api/ws/test", (ws) => {
  ws.on("message", msg => {
    ws.send(msg);
  });
});

app.ws("/api/ws/playing", (ws) => {
  try {
    ws.on("message", msg => {
      let jsonData = null;
      try {
        jsonData = JSON.parse(msg);
      } catch (e) {
        return console.log(e);
      }
      if (!jsonData.server) {
        ws.send(JSON.stringify({ exist: false }));
        return ws.close();
      }
      const guild = client.guilds.cache.get(jsonData.server);
      if (!guild) {
        ws.send(JSON.stringify({ exist: false }));
        return ws.close();
      }
      const queue = client.queue.get(guild.id);
      if (!queue) {
        return ws.send(JSON.stringify({ playing: false }));
      }
      if (queue.songs.length < 1) {
        return ws.send(JSON.stringify({ playing: false }));
      }
      const song = queue.current;
      if (!song) {
        return ws.send(JSON.stringify({ playing: false }));
      }
      try {
        ws.send(JSON.stringify({
          name: guild.name,
          title: song.title,
          url: song.url,
          thumbnail: song.thumbnail,
          now: Math.floor((queue.connection.dispatcher.streamTime - queue.connection.dispatcher.pausedTime) / 1000),
          total: Number(song.duration),
          pause: queue.playing,
          playing: true,
          volume: queue.volume
        }));
      } catch {
        ws.send(JSON.stringify({ playing: false }));
      }
    });
  } catch (e) {
    console.log(e);
  }
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/api/status", function(req, res) {
  res.send("online");
});

app.get("/loaderio-3cfcf9891b2ae7e544b9d6cdd3220394", (req, res) => {
  res.send("loaderio-3cfcf9891b2ae7e544b9d6cdd3220394")
});

app.get("/api/exist", async function(req, res) {
  if (!req.query.server) return res.send({ exist: false });
  let guild = client.guilds.cache.get(req.query.server);
  if (!guild) return res.send({ exist: false });
  res.send({ exist: true });
});

app.get("/api/playing", async function(req, res) {
  if (!req.query.server) return res.send({ error: true, code: 101 });
  const guild = client.guilds.cache.get(req.query.server);
  if (!guild) return res.send({ exist: false });
  const queue = client.queue.get(guild.id);
  if (!queue) return res.send({ playing: false });
  const song = queue.songs[0];
  if (!song) return res.send({ playing: false });
  try {
    res.status(200).send({
      name: guild.name,
      title: song.title,
      url: song.url,
      thumbnail: song.thumbnail,
      now: Math.floor((queue.connection.dispatcher.streamTime - queue.connection.dispatcher.pausedTime) / 1000),
      total: Number(song.duration),
      pause: queue.playing,
      playing: true
    });
  } catch {
    res.send({ playing: false });
  }
});

app.get("/api/lyrics", async function(req, res) {
  if (!req.query.title) return res.send({ error: true, code: 101 });
  let lyrics;
  try {
    lyrics = await lyricsFinder(req.query.title, "");
  } catch (error) {
    res.send({ error: true, code: 201 });
  }
  if (lyrics) return res.send({ lyrics });
  else return res.send({ error: true, code: 201 });
});

app.use((req, res, next) => {
  if (!req.query.token) next();
  else {
    try {
      let textParts = req.query.token.split(":");
      let iv = Buffer.from(textParts.shift(), "hex");
      let encryptedText = Buffer.from(textParts.join(":"), "hex");
      let decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(process.env.ENCODE_KEY), iv);
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      req.userToken = decrypted.toString();
      next();
    } catch {
      res.clearCookie("token");
      next();
    }
  }
});

app.use(require("cookie-parser")());

app.get("/api/auth/login", function(req, res) {
  if (!req.query.code) return res.status(302).send({ token: null });
  const data = {
    client_id: "848006097197334568",
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "authorization_code",
    redirect_uri: "https://app.blackcatbot.tk/callback/",
    code: req.query.code,
    scope: "identify guilds"
  };
  fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams(data),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
    .then(res => res.json())
    .then(json => {
      let text = `${json.token_type} ${json.access_token}`
      let iv = crypto.randomBytes(16);
      let cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(process.env.ENCODE_KEY), iv);
      let encrypted = cipher.update(text);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      let token = iv.toString("hex") + ":" + encrypted.toString("hex");
      res.status(200).json({
        token
      });
    })
    .catch(error => {
      console.log(error);
      res.status(500).send({ error: true, message: "發送請求到Discord伺服器時發生錯誤" });
    });
});

app.get("/api/auth/info", function(req, res) {
  if (!req.userToken) return res.status(400).send({ error: true, message: "沒有提供Token，請重新登入" });
  const token = req.userToken;
  fetch("https://discord.com/api/users/@me", {
      headers: {
        authorization: token
      }
    })
    .then(info => info.json())
    .then(json => res.send(json))
    .catch(error => {
      console.log(error);
      res.status(500).send({ error: true });
    });
});

async function checkModify(token, guildID) {
  return new Promise((reslove) => {
    fetch("https://discord.com/api/users/@me", {
      headers: {
        authorization: token
      }
    }).then(res => res.json()).then(async json => {
      const guild = await client.guilds.fetch(guildID).catch(() => { reslove(4); });
      const member = guild.members.cache.get(json.id);
      if (!member) reslove(1);
      else if (!member.voice.channel) reslove(2);
      else if (!member.voice.channel.members.get("848006097197334568")) reslove(3);
      else reslove(0);
    }).catch(() => reslove(1));
  });
}

app.get("/api/pause", async function(req, res) {
  if (!req.userToken || !req.query.guild) return res.send({ message: "發生錯誤，請重新整理頁面", red: true });
  const premission = await checkModify(req.userToken, req.query.guild);
  switch (premission) {
    case 1:
      return res.send({ message: "請先加入這個伺服器!", red: true });
    case 2:
      return res.send({ message: "請先加入一個語音頻道!", red: true });
    case 3:
      return res.send({ message: "請跟機器人在同一個頻道裡!", red: true });
    case 4:
      return res.send({ message: "沒有找到伺服器", red: true });
    case 5:
      return res.send({ error: true, code: 101 });
  }
  try {
    const queue = client.queue.get(req.query.guild);
    if (!queue) return res.send({ error: true, code: 101 });
    if (queue.playing) {
      queue.playing = false;
      queue.connection.dispatcher.pause();
      queue.textChannel.send("<:pause:827737900359745586> ┃ 歌曲已由網頁面板暫停").then(sent => {
        setTimeout(function() {
          sent.delete();
        }, 60000);
      }).catch(console.error);
      res.send({ message: "指令發送成功!", red: false });
    } else {
      res.send({ message: "歌曲已經暫停了", red: true });
    }
  } catch (e) {
    res.send({ message: e, red: true });
  }
});

app.get("/api/resume", async function(req, res) {
  if (!req.userToken || !req.query.guild) return res.send({ message: "發生錯誤，請重新整理頁面", red: true });
  const premission = await checkModify(req.userToken, req.query.guild);
  switch (premission) {
    case 1:
      return res.send({ message: "請先加入這個伺服器!", red: true });
    case 2:
      return res.send({ message: "請先加入一個語音頻道!", red: true });
    case 3:
      return res.send({ message: "請跟機器人在同一個頻道裡!", red: true });
    case 4:
      return res.send({ message: "沒有找到伺服器", red: true });
    case 5:
      return res.send({ error: true, code: 101 });
  }
  try {
    const queue = client.queue.get(req.query.guild);
    if (!queue) return res.send({ error: true, code: 101 });
    if (!queue.playing) {
      queue.playing = true;
      queue.connection.dispatcher.resume();
      queue.textChannel.send("<:play:827734196243398668> ┃ 由網頁面板繼續播放歌曲").then(sent => {
        setTimeout(function() {
          sent.delete();
        }, 60000);
      }).catch(console.error);
      res.send({ message: "指令發送成功!", red: false });
    } else {
      res.send({ message: "歌曲已經在播放了", red: true });
    }
  } catch (e) {
    res.send({ message: `發送指令時出現錯誤: ${e.message}`, red: true });
  }
});

app.get("/api/skip", async function(req, res) {
  if (!req.userToken || !req.query.guild) return res.send({ message: "發生錯誤，請重新整理頁面", red: true });
  const premission = await checkModify(req.userToken, req.query.guild);
  switch (premission) {
    case 1:
      return res.send({ message: "請先加入這個伺服器!", red: true });
    case 2:
      return res.send({ message: "請先加入一個語音頻道!", red: true });
    case 3:
      return res.send({ message: "請跟機器人在同一個頻道裡!", red: true });
    case 4:
      return res.send({ message: "沒有找到伺服器", red: true });
    case 5:
      return res.send({ error: true, code: 101 });
  }
  try {
    const queue = client.queue.get(req.query.guild);
    if (!queue) return res.send({ error: true, code: 101 });
    queue.playing = true;
    queue.connection.dispatcher.end();
    queue.textChannel.send("<:next:766802340538875964> ┃ 由網頁面板跳過目前歌曲").then(sent => {
      setTimeout(function() {
        sent.delete();
      }, 60000);
    }).catch(console.error);
    res.send({ message: "指令發送成功!", red: false });
  } catch (e) {
    res.send({ message: e, red: true });
  }
});

app.use((req, res) => {
  res.status(404).sendFile(join(__dirname, "static", "404.html"))
});

app.use(io.expressErrorHandler());

app.listen(process.env.PORT || 8080);

process.on("exit", (code) => {
  console.log(`Process exit with code: ${code}`);
});

process.on("SIGINT", () => {
  client.destroy();
  console.log("Bot is shutting down by Pm2");
  process.exit(0);
});