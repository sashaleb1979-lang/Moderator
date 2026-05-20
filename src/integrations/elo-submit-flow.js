"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const {
  parseLegacyElo,
  tierForLegacyElo,
} = require("./elo-review-store");

function cleanString(value, limit = 2000) {
  return String(value || "").trim().slice(0, Math.max(0, Number(limit) || 0));
}

function resolveLegacyEloSubmitTargetChannelId(options = {}) {
  return cleanString(
    options.sessionChannelId || options.panelChannelId || options.fallbackChannelId,
    80
  );
}

function buildLegacyEloSubmitStepPayload(options = {}) {
  const rawText = cleanString(options.rawText, 1000);
  const channelText = cleanString(options.channelText, 200) || "этот канал";
  const noticeText = cleanString(options.noticeText, 1000);
  const elo = parseLegacyElo(rawText);
  const tier = tierForLegacyElo(elo);
  const lines = [];

  if (noticeText) lines.push(noticeText);
  if (elo) lines.push(`ELO: **${elo}**.`);
  if (tier) lines.push(`Tier по ELO: **${tier}**.`);

  if (rawText) {
    lines.push(`Теперь отправь **одним следующим сообщением** скрин в ${channelText}.`);
    lines.push("Подойдёт обычное вложение или вставка картинки через Ctrl+V.");
  } else {
    lines.push(`Теперь отправь **одним следующим сообщением** текст с ELO и скрин в ${channelText}.`);
    lines.push("Пример: `73 elo` и картинка в этом же сообщении.");
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(rawText ? "Готово. Кидай ELO-скрин" : "Готово. Кидай ELO и скрин")
        .setDescription(lines.join("\n"))
        .addFields({
          name: "На скрине",
          value: [
            "актуальное значение ELO",
            "твой ник или профиль, чтобы модеры сверили заявку",
          ].join("\n"),
          inline: false,
        })
        .setFooter({ text: rawText ? "После скрина заявка уйдёт модерам на проверку." : "После этого сообщения заявка уйдёт модерам на проверку." }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("elo_submit_cancel")
          .setLabel("Отменить шаг")
          .setEmoji("✖️")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function getLegacyEloSubmitMessageError(options = {}) {
  const rawText = cleanString(options.rawText, 1000);
  const hasImageAttachment = options.hasImageAttachment === true;
  const elo = parseLegacyElo(rawText);
  const tier = tierForLegacyElo(elo);

  if (!rawText || !elo || !tier) {
    return "В тексте ELO заявки нужно указать число ELO минимум 10, например `73` или `73 elo`, и приложить скрин в этом же сообщении.";
  }

  if (!hasImageAttachment) {
    return "В одной ELO заявке должны быть и число ELO в тексте, и скрин во вложении. Пришли одно сообщение целиком.";
  }

  return "";
}

module.exports = {
  buildLegacyEloSubmitStepPayload,
  getLegacyEloSubmitMessageError,
  resolveLegacyEloSubmitTargetChannelId,
};