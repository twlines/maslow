import "dotenv/config";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("No TELEGRAM_BOT_TOKEN found");
  process.exit(1);
}

console.log("Creating bot with token:", token.slice(0, 10) + "...");

const bot = new Telegraf(token);

bot.on("message", (ctx) => {
  console.log("Received message from:", ctx.from?.id);
  console.log("Message text:", ctx.message);
  ctx.reply("Debug bot received: " + JSON.stringify(ctx.message).slice(0, 100));
});

console.log("Launching bot...");
bot.launch()
  .then(() => {
    console.log("Bot launched successfully!");
  })
  .catch((err) => {
    console.error("Launch failed:", err);
  });

console.log("Launch called, waiting for events...");

// Handle graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
