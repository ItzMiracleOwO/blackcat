const { MessageEmbed, Permissions, Util } = require("discord.js");
const YouTube = require("youtube-sr").default;
const Player = require("../include/player");

module.exports = {
  name: "playlist",
  cooldown: 3,
  aliases: ["pl"],
  description: "播放Youtube的播放清單",
  register: true,
  slash: {
    name: "playlist",
    description: "播放Youtube的播放清單",
    options: [
      {
        name: "網址或搜尋文字",
        description: "在Youtube上的網址或搜尋字串",
        type: 3,
        required: true,
      }
    ]
  },
  slashReply: true,
  async execute(message, args) {
    const { channel } = message.member.voice;

    const serverQueue = message.client.queue.get(message.guild.id);
    if (serverQueue && channel !== message.guild.me.voice.channel) return message.channel.send("❌ ┃ 你必須跟我在同一個頻道裡面!").catch(console.error);

    if (!args.length) return message.channel.send("❌ ┃ 請輸入播放清單名稱或網址!").catch(console.error);
    if (!channel) return message.channel.send("❌ ┃ 你要先加入一個語音頻道...不然我要在哪的房間放收音機呢？").catch(console.error);

    if (!channel.joinable) return message.channel.send("❌ ┃ 無法連接到語音頻道!因為我沒有權限加入你在的房間!").catch(console.error);
    if (!channel.speakable) return message.channel.send("❌ ┃ 我沒辦法在你的語音頻道裡放收音機!因為我沒有說話的權限!");

    const search = args.join(" ");
    const pattern = /^.*(youtu.be\/|list=)([^#\&\?]*).*/gi;
    const url = args[0];
    const urlValid = pattern.test(args[0]);

    const queueConstruct = {
      textChannel: message.channel,
      channel,
      connection: null,
      songs: [],
      loop: false,
      repeat: false,
      volume: 60,
      playing: true,
      filter: [],
      current: null,
      player: null,
      audioPlayer: null,
      converter: {
        ffmpeg: null,
        opus: null,
        volume: null
      }
    };

    let song = null;
    let playlist = null;
    let videos = [];

    let playlistEmbed = new MessageEmbed()
      .setTitle("正在讀取播放清單, 請稍等...")
      .setColor("BLURPLE");

    let sent = await message.channel.send({
      embeds: [playlistEmbed]
    });

    if (urlValid) {
      try {
        playlist = await YouTube.getPlaylist(url);
        videos = await playlist.fetch();
      } catch (error) {
        console.error(error);
        return message.channel.send("❌ ┃ 沒有找到播放清單").catch(console.error);
      }
    } else {
      try {
        const results = await YouTube.search(search, {
          safeSearch: true,
          type: "playlist"
        });
        playlist = await YouTube.getPlaylist(results[0].url);
        videos = await playlist.fetch();
      } catch (error) {
        console.error(error);
        return message.channel.send("❌ ┃ 沒有找到播放清單...").catch(console.error);
      }
    }

    videos.videos.forEach((video) => {
      song = {
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration: video.duration / 1000,
        thumbnail: video.thumbnail.url,
        type: "playlist_song",
        by: message.author.username
      };

      if (serverQueue) {
        serverQueue.songs.push(song);
      } else {
        queueConstruct.songs.push(song);
      }
    });

    playlistEmbed
      .setTitle(`${playlist.title}`)
      .setURL(playlist.url)
      .setDescription(`\n<:music_add:827734890924867585> ┃ 已新增${playlist.videoCount}首歌`)
      .setColor("BLURPLE")
      .setThumbnail(playlist.thumbnail.url);
    sent.edit({
      embeds: [playlistEmbed]
    });

    if (!serverQueue) message.client.queue.set(message.guild.id, queueConstruct);

    if (!serverQueue) {
      try {
        queueConstruct.player = new Player(queueConstruct, message.client);
        queueConstruct.player.connect(channel);
        await message.channel.send(`<:joinvc:866176795471511593> ┃ 已加入\`${Util.escapeMarkdown(channel.name)}\`並將訊息發送至<#${message.channel.id}>`);
        queueConstruct.player.play(queueConstruct.songs[0]);
      } catch (error) {
        console.error(error);
        message.client.queue.delete(message.guild.id);
        await channel.leave();
        return message.channel.send(`❌ ┃ 無法加入語音頻道...原因: ${error.message}`).catch(console.error);
      }
    }
  }
};