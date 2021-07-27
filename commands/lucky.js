const { MessageEmbed } = require("discord.js");

module.exports = {
  name: "lucky",
  description: "查看自己的幸運指數",
  regsiter: true,
  slash: {
    name: "lucky",
    description: "查看自己的幸運指數"
  },
  slashReply: true,
  execute(message) {
    function getRandomNum(start, end) {
      return start + Math.random() * (end - start + 1);
    }

    const lucky = Math.ceil(getRandomNum(1, 100));
    const luckyPercent = Math.ceil(lucky / 10);
    const bar = ("🍀 ".repeat(luckyPercent) + "❌ ".repeat(10 - luckyPercent)).trim();

    if (!message.slash.raw) {
      if (message.mentions.members.size <= 0) {
        const embed = new MessageEmbed()
          .setTitle(`${message.author.username}的幸運指數`)
          .setDescription(`🍀 ┃ 你的幸運指數是${lucky}\n\n${bar}`)
          .setColor("#5865F2");
        return message.channel.send(embed).catch(console.error);
      } else {
        const embed = new MessageEmbed()
          .setTitle(`${message.mentions.members.first().displayName}的幸運指數`)
          .setDescription(`${message.mentions.members.first().displayName}的幸運指數是${lucky}\n\n${bar}`)
          .setColor("#5865F2");
        return message.channel.send(embed).catch(console.error);
      }
    } else {
      const embed = new MessageEmbed()
        .setTitle(`${message.author.username}的幸運指數`)
        .setDescription(`🍀 ┃ 你的幸運指數是${lucky}\n\n${bar}`)
        .setColor("#5865F2");
      if (message.slash.raw) return message.slash.sendEmbed(embed);
      else return message.channel.send(embed).catch(console.error);
    }
  }
};