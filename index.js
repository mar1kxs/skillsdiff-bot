require("dotenv").config();
const {
  Bot,
  GrammyError,
  HttpError,
  Keyboard,
  InlineKeyboard,
  session,
} = require("grammy");
const {
  conversations,
  createConversation,
} = require("@grammyjs/conversations");
const { FileAdapter } = require("@grammyjs/storage-file");

// Constants
const CONFIG = {
  GROUP_ID: -1002447226535,
  ADMINS: [741130407, 1914761214],
  GAMES: {
    VALORANT: {
      name: "valorantConversation",
      questions: [
        { key: "age", text: "Сколько тебе лет?" },
        { key: "rank", text: "Какой у тебя ранг в Valorant?" },
        { key: "agents", text: "На каких агентах играешь?" },
        { key: "goals", text: "Какие цели и ожидания от тренировок?" },
      ],
    },
    DOTA: {
      name: "dotaConversation",
      questions: [
        { key: "age", text: "Сколько тебе лет?" },
        { key: "mmr", text: "Сколько у тебя ммр?" },
        {
          key: "heroes",
          text: "На какой позиции играешь?\nИ какие персонажи интересуют?",
        },
        { key: "goals", text: "Какие цели и ожидания от тренировок?" },
      ],
    },
  },
  DIALOG_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
};

// Dialog Manager Class Definition
class DialogManager {
  constructor() {
    this.activeDialogs = new Map();
    this.initCleanupInterval();
  }

  // Private utility method for ID validation
  #validateUserId(userId) {
    return typeof userId === "string" && /^\d+$/.test(userId);
  }

  initCleanupInterval() {
    setInterval(() => this.cleanupStaleDialogs(), CONFIG.CLEANUP_INTERVAL);
  }

  cleanupStaleDialogs() {
    const now = Date.now();
    for (const [userId, dialog] of this.activeDialogs.entries()) {
      if (now - dialog.startTime > CONFIG.DIALOG_TIMEOUT) {
        this.close(userId);
      }
    }
  }

  create(userId, adminId) {
    const stringUserId = String(userId);
    const stringAdminId = String(adminId);

    if (
      !this.#validateUserId(stringUserId) ||
      !this.#validateUserId(stringAdminId)
    ) {
      throw new Error("Invalid user or admin ID");
    }

    // Проверяем, нет ли уже активного диалога
    if (this.activeDialogs.has(stringUserId)) {
      return false;
    }

    this.activeDialogs.set(stringUserId, {
      userId: stringUserId,
      adminId: stringAdminId,
      status: "open",
      startTime: Date.now(),
    });
    return true;
  }

  isUserInDialog(userId) {
    return this.activeDialogs.has(String(userId));
  }

  isAdminInDialog(adminId) {
    return Array.from(this.activeDialogs.values()).some(
      (dialog) => dialog.adminId === String(adminId)
    );
  }

  getDialogByUser(userId) {
    return this.activeDialogs.get(String(userId));
  }

  getDialogByAdmin(adminId) {
    return Array.from(this.activeDialogs.values()).find(
      (dialog) => dialog.adminId === String(adminId)
    );
  }

  getDialogParticipant(userId) {
    const dialog = this.getDialogByUser(String(userId));
    if (dialog) return "user";

    const adminDialog = this.getDialogByAdmin(String(userId));
    if (adminDialog) return "admin";

    return null;
  }

  close(userId) {
    return this.activeDialogs.delete(String(userId));
  }
}

const dialogManager = new DialogManager();

function createGameConversation(gameName, gameConfig) {
  const conversationHandler = async (conversation, ctx) => {
    const answers = {};
    for (const question of gameConfig.questions) {
      await ctx.reply(question.text);
      const response = await conversation.wait();
      answers[question.key] = response.message.text;
    }

    const formattedMessage =
      `${
        ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name
      } оплатил ${gameName}\n` +
      Object.entries(answers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n") +
      `\nВремя СET: ${new Date().toLocaleTimeString()}`;

    await ctx.api.sendMessage(CONFIG.GROUP_ID, formattedMessage);
    await ctx.reply("Спасибо! Ваши данные отправлены тренерам.", {
      reply_markup: startKeyboard,
    });
  };

  Object.defineProperty(conversationHandler, "name", {
    value: gameConfig.name,
  });

  return conversationHandler;
}

function isAdmin(id) {
  return CONFIG.ADMINS.includes(Number(id));
}

const fileSendSessions = new Map();
const adminMenu = new InlineKeyboard()
  .text("📤 Отправить файл пользователю", "admin_sendfile")
  .text("❌ Отменить отправку", "admin_cancel");

const startKeyboard = new Keyboard()
  .text("Хочу задать вопрос")
  .row()
  .text("Я оплатил услугу")
  .resized()
  .oneTime();

function createBot() {
  const bot = new Bot(process.env.BOT_API_KEY);

  bot.use(
    session({
      initial: () => ({
        lastQuestions: {},
        answerMeta: null,
      }),
      storage: new FileAdapter({
        dirName: "sessions",
      }),
    })
  );

  bot.use(conversations());

  // Register conversations
  bot.use(
    createConversation(
      createGameConversation("Valorant", CONFIG.GAMES.VALORANT)
    )
  );
  bot.use(
    createConversation(createGameConversation("Dota 2", CONFIG.GAMES.DOTA))
  );

  // Command handlers
  bot.command("start", async (ctx) => {
    // Проверка приватного чата
    if (ctx.chat.type !== "private") {
      await ctx.reply(
        "Эта команда работает только в личных сообщениях с ботом."
      );
      return;
    }

    // Проверка username
    if (!ctx.from.username) {
      await ctx.reply(
        "❗ Пожалуйста, установите Username в Telegram для корректной связи.\n\nКак это сделать:\n1. Откройте настройки Telegram\n2. Выберите 'Имя пользователя'\n3. Придумайте уникальный username"
      );
      return;
    }

    const keyboard = startKeyboard;

    await ctx.reply(
      "Привет\\! Я бот [SkillsDiff](https://example.com)\nВыбери что тебя интересует ниже 👇",
      {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      }
    );
  });

  // Game handlers
  bot.hears("Я оплатил услугу", async (ctx) => {
    const gameKeyboard = new Keyboard()
      .text("Valorant")
      .text("Dota 2")
      .row()
      .text("Назад")
      .resized()
      .oneTime();

    await ctx.reply("Выбери игру", {
      reply_markup: gameKeyboard,
    });
  });

  bot.hears("Valorant", async (ctx) => {
    await ctx.conversation.enter(CONFIG.GAMES.VALORANT.name);
  });

  bot.hears("Dota 2", async (ctx) => {
    await ctx.conversation.enter(CONFIG.GAMES.DOTA.name);
  });

  bot.hears("Назад", async (ctx) => {
    await ctx.reply("Вы вернулись назад", {
      reply_markup: startKeyboard,
    });
  });

  // FAQ handlers
  bot.hears("Хочу задать вопрос", async (ctx) => {
    const faqInlineKeyboard = new InlineKeyboard()
      .text("1", "answer-1")
      .text("2", "answer-2")
      .text("3", "answer-3")
      .row()
      .text("4", "answer-4")
      .text("5", "answer-5")
      .text("6", "answer-6");
    const faqKeyboard = new Keyboard()
      .text("Не нашел свой вопрос!")
      .text("Назад")
      .resized();
    await ctx.reply(
      "*Часто задаваемые вопросы:*\n\n1\\. Как оплатить услугу?\n2\\. Что делать после того как оплатил?\n3\\. Как определяется время тренировок? Можно ли перенести занятие?\n4\\. Какие гарантии роста вы даете? Что если не будет результата?\n5\\. Могу ли я записывать тренировку?\n6\\. Как стать тренером?\n\n\nЧтобы узнать ответ выберите свой вопрос ниже 👇",
      {
        parse_mode: "MarkdownV2",
        reply_markup: faqInlineKeyboard,
      }
    );
    await ctx.reply("Не нашел свой вопрос? 👇", {
      reply_markup: faqKeyboard,
    });
  });

  bot.hears("Не нашел свой вопрос!", async (ctx) => {
    ctx.reply("Хотите начать диалог с техподдержкой?", {
      reply_markup: new InlineKeyboard()
        .text("Да", "start-conv")
        .text("Нет", "cancel"),
    });
  });

  //! ADMIN
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.reply("⛔ У вас нет доступа.");
    }

    await ctx.reply("🛠 Админ-панель", {
      reply_markup: adminMenu,
    });
  });

  bot.callbackQuery("admin_sendfile", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ У вас нет доступа.",
        show_alert: true,
      });
    }

    fileSendSessions.set(ctx.from.id, { step: "awaitingUserId" });
    await ctx.answerCallbackQuery();
    await ctx.reply("Введите ID пользователя, которому нужно отправить файл:");
  });

  bot.callbackQuery("admin_cancel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ У вас нет доступа.",
        show_alert: true,
      });
    }

    if (fileSendSessions.has(ctx.from.id)) {
      fileSendSessions.delete(ctx.from.id);
      await ctx.answerCallbackQuery({
        text: "❌ Отправка отменена.",
        show_alert: false,
      });
      await ctx.reply("Отправка файла отменена.");
    } else {
      await ctx.answerCallbackQuery({
        text: "Нет активной отправки.",
        show_alert: false,
      });
      await ctx.reply("Сейчас нет активной отправки.");
    }
  });

  //! CallBack
  bot.callbackQuery("cancel", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply("Чем могу помочь еще?", {
      reply_markup: startKeyboard,
    });
  });

  bot.callbackQuery("start-conv", async (ctx) => {
    ctx.answerCallbackQuery();

    const userId = ctx.from.id;
    const userName = ctx.from.username;

    // Сохраняем данные в сессии
    ctx.session.waitingForSupport = {
      userId: userId,
      userName: userName,
      messageId: ctx.callbackQuery.message.message_id, // сохраняем ID сообщения
    };

    await ctx.reply("Ожидайте подключения хелпера...", {
      reply_markup: new Keyboard().text("Покинуть диалог").oneTime().resized(),
    });

    // Отправляем сообщение в группу поддержки с сохранением messageId
    const supportMessage = await ctx.api.sendMessage(
      CONFIG.GROUP_ID,
      `@${userName} (ID: ${userId}) запрашивает техподдержку`,
      {
        reply_markup: new InlineKeyboard()
          .text("Ответить", `answer_${userId}`) // добавляем userId в callback_data
          .text("Закрыть", `close_${userId}`),
      }
    );

    // Сохраняем ID сообщения в группе поддержки
    ctx.session.waitingForSupport.supportMessageId = supportMessage.message_id;
  });

  bot.callbackQuery(/^answer_(\d+)$/, async (ctx) => {
    ctx.answerCallbackQuery();

    const userId = String(ctx.match[1]);
    const adminId = String(ctx.from.id);

    try {
      // Проверяем, не занят ли админ другим диалогом
      if (dialogManager.isAdminInDialog(adminId)) {
        await ctx.reply(
          "У вас уже есть активный диалог. Завершите его перед началом нового."
        );
        return;
      }

      // Проверяем, не находится ли пользователь уже в диалоге
      if (dialogManager.isUserInDialog(userId)) {
        await ctx.reply(
          "Этот пользователь уже находится в диалоге с другим администратором."
        );
        return;
      }

      // Создаем диалог
      if (!dialogManager.create(userId, adminId)) {
        await ctx.reply(
          "Не удалось создать диалог. Возможно, он уже существует."
        );
        return;
      }

      // Отправляем личное сообщение пользователю
      await ctx.api.sendMessage(
        userId,
        "Администратор подключился к диалогу. Можете писать свои сообщения.",
        {
          reply_markup: new Keyboard()
            .text("Покинуть диалог")
            .oneTime()
            .resized(),
        }
      );

      // Отправляем личное сообщение админу
      await ctx.api.sendMessage(
        adminId,
        "Диалог начат. Теперь вы можете отвечать пользователю.",
        {
          reply_markup: new Keyboard()
            .text("Закрыть диалог")
            .oneTime()
            .resized(),
        }
      );

      // Обновляем сообщение в группе поддержки (без клавиатуры)
      await ctx.api.editMessageText(
        CONFIG.GROUP_ID,
        ctx.callbackQuery.message.message_id,
        `Диалог с пользователем ID: ${userId} начат администратором @${ctx.from.username}`
      );
    } catch (error) {
      console.error("Error in starting dialog:", error);
      dialogManager.close(userId);
      await ctx.reply(
        "Произошла ошибка при начале диалога. Возможно, пользователь заблокировал бота."
      );
    }
  });

  bot.callbackQuery(/^close_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1]; // Получаем userId из callback_data
    ctx.answerCallbackQuery();

    const dialog = dialogManager.getDialog(userId);
    if (dialog) {
      dialogManager.close(userId);
      try {
        await ctx.api.sendMessage(
          userId,
          "Ваш диалог с техподдержкой был завершен.",
          {
            reply_markup: startKeyboard,
          }
        );
        await ctx.reply("Вы закрыли диалог.");

        // Обновляем сообщение в группе поддержки
        await ctx.api.editMessageText(
          CONFIG.GROUP_ID,
          ctx.callbackQuery.message.message_id,
          `Диалог с пользователем ID: ${userId} завершен администратором @${ctx.from.username}`
        );
      } catch (error) {
        console.error("Error in admin-close handler:", error);
        await ctx.reply("Произошла ошибка при закрытии диалога.");
      }
    } else {
      await ctx.reply("Диалог не найден.");
    }
  });

  bot.hears("Закрыть диалог", async (ctx) => {
    const adminId = String(ctx.from.id);
    const dialog = dialogManager.getDialogByAdmin(adminId);

    if (!dialog) {
      await ctx.reply("У вас нет активных диалогов.");
      return;
    }

    try {
      // Уведомляем пользователя
      await ctx.api.sendMessage(
        dialog.userId,
        "Диалог с техподдержкой завершен.",
        {
          reply_markup: startKeyboard,
        }
      );

      // Уведомляем админа
      await ctx.reply("Диалог закрыт.", {
        reply_markup: new Keyboard().text("Назад").oneTime().resized(),
      });

      // Закрываем диалог
      dialogManager.close(dialog.userId);
    } catch (error) {
      console.error("Error in closing dialog:", error);
      await ctx.reply("Произошла ошибка при закрытии диалога.");
    }
  });

  bot.hears("Покинуть диалог", async (ctx) => {
    const userId = String(ctx.from.id);

    const dialog = dialogManager.getDialogByUser(userId); // Fixed: changed from getDialog to getDialogByUser
    if (dialog) {
      dialogManager.close(userId);
      await ctx.reply("Вы покинули диалог.", {
        reply_markup: startKeyboard,
      });
      await bot.api.sendMessage(
        CONFIG.GROUP_ID,
        `Пользователь @${
          ctx.from.username || ctx.from.first_name
        } покинул диалог с техподдержкой.`
      );
    } else {
      await ctx.reply("Диалог не найден.");
    }
  });

  //! Answer callbacks
  bot.callbackQuery("answer-1", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply("Оплата происходит на нашем [сайте](https://example.com)", {
      parse_mode: "MarkdownV2",
    });
  });

  bot.callbackQuery("answer-2", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply(
      'После оплаты вам нужно зайти в этого бота и нажать кнопку "Я оплатил услугу"\nЗаполнить небольшую анкету и позже свами свяжется тренер! ',
      {
        parse_mode: "MarkdownV2",
      }
    );
  });

  bot.callbackQuery("answer-3", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply(
      "Время тренировок согласовывается индивидуально с тренером\\.\nПеренос занятия возможен не позднее чем за 24 часа до начала тренировки",
      {
        parse_mode: "MarkdownV2",
      }
    );
  });

  bot.callbackQuery("answer-4", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply(
      "Мы гарантируем улучшение ваших навыков при условии выполнения всех рекомендаций тренера",
      {
        parse_mode: "MarkdownV2",
      }
    );
  });

  bot.callbackQuery("answer-5", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply("Да вы можете записывать тренировку в случае необходимости", {
      parse_mode: "MarkdownV2",
    });
  });

  bot.callbackQuery("answer-6", async (ctx) => {
    ctx.answerCallbackQuery();
    ctx.reply(
      "Если вы хотите стать тренером заполните форму на [SkillsDiff](https://www.skillsdiff.com)",
      {
        parse_mode: "MarkdownV2",
      }
    );
  });

  bot.on("message:text", async (ctx) => {
    const adminId = ctx.from.id;

    // Если это админ и он в сессии отправки файла
    if (fileSendSessions.has(adminId)) {
      const session = fileSendSessions.get(adminId);

      if (session.step === "awaitingUserId") {
        const userId = ctx.message.text.trim();
        if (!/^\d+$/.test(userId)) {
          return ctx.reply("❗ Введите корректный числовой ID.");
        }
        session.userId = userId;
        session.step = "awaitingFile";
        return ctx.reply(
          "Отправьте файл, который нужно передать пользователю."
        );
      }
    }

    // ➡️ Если это не админская сессия, идём в основной код

    const senderId = String(ctx.from.id);
    const text = ctx.message.text;

    if (
      text.startsWith("/") ||
      text === "Покинуть диалог" ||
      text === "Закрыть диалог" ||
      text === "Назад"
    ) {
      return;
    }

    const participantRole = dialogManager.getDialogParticipant(senderId);
    if (!participantRole) {
      return;
    }

    let dialog;
    if (participantRole === "user") {
      dialog = dialogManager.getDialogByUser(senderId);
      try {
        await ctx.api.sendMessage(
          dialog.adminId,
          `От пользователя ${
            ctx.from.username ? `@${ctx.from.username}` : senderId
          }:\n${text}`
        );
      } catch (error) {
        console.error("Error sending message to admin:", error);
        await ctx.reply("⚠️ Ошибка при отправке сообщения");
        dialogManager.close(senderId);
      }
    } else if (participantRole === "admin") {
      dialog = dialogManager.getDialogByAdmin(senderId);
      try {
        await ctx.api.sendMessage(dialog.userId, text);
      } catch (error) {
        console.error("Error sending message to user:", error);
        await ctx.reply("⚠️ Ошибка при отправке сообщения");
        dialogManager.close(dialog.userId);
      }
    }
  });

  bot.on("message:document", async (ctx) => {
    const adminId = ctx.from.id;

    if (fileSendSessions.has(adminId)) {
      const session = fileSendSessions.get(adminId);

      if (session.step === "awaitingFile") {
        const userId = session.userId;

        try {
          await ctx.api.sendMessage(
            userId,
            "Админ отправил тебе презентацию от тренера:"
          );
          await ctx.api.sendDocument(userId, ctx.message.document.file_id);
          await ctx.reply(`✅ Файл отправлен пользователю ID: ${userId}`, {
            reply_markup: adminMenu,
          });

          // (опционально) логируем в группу
          try {
            await ctx.api.sendMessage(
              CONFIG.GROUP_ID,
              `Админ @${ctx.from.username} отправил файл пользователю ID: ${userId}`
            );
          } catch (logError) {
            console.error("Ошибка отправки лога в группу:", logError);
            // Не мешаем админу — просто пишем в консоль
          }
        } catch (error) {
          console.error("Ошибка отправки файла пользователю:", error);
          await ctx.reply(
            "⚠️ Не удалось отправить файл. Возможно, пользователь заблокировал бота или ID некорректен.",
            {
              reply_markup: adminMenu,
            }
          );
        }

        fileSendSessions.delete(adminId);
      }
    }
  });

  // Error handling
  bot.catch((err) => {
    console.error(
      `Error handling update ${err.ctx.update.update_id}:`,
      err.error
    );
  });

  return bot;
}

const bot = createBot();
bot.start();
