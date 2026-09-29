const loginPanel = document.querySelector("#login-panel"),
  editorPanel = document.querySelector("#editor-panel"),
  message = document.querySelector("#message"),
  fields = [
    "heroAnnouncement",
    "partnerKicker",
    "partnerHeading",
  ];
const request = async (url, options) => {
  const response = await fetch(url, options),
    data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const showLogin = () => {
  loginPanel.hidden = false;
  editorPanel.hidden = true;
  gamePanel.hidden = true;
};

// --- Game balance ---------------------------------------------------------
const gamePanel = document.querySelector("#game-panel");
const formatAmount = (value) => new Intl.NumberFormat("en-US").format(Number(value || 0));
const shorten = (value) => (value && value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value || "");
const element = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const txLink = (hash) =>
  element("a", { href: `https://cardanoscan.io/transaction/${hash}`, target: "_blank", rel: "noreferrer", textContent: `${hash.slice(0, 10)}… ↗` });

const describeScan = (at, result) => {
  if (!at) return "never";
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  const when = minutes < 1 ? "just now" : `${minutes} min ago`;
  if (result?.error) return `${when} · failed: ${result.error}`;
  if (result?.skipped === "no_treasury") return `${when} · no treasury set`;
  return `${when} · ${result?.credited ?? 0} credited`;
};

const gameRequest = (body) =>
  request("/api/admin/game", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);

const renderGame = (data) => {
  const { settings, totals } = data;
  document.querySelector("#gameEnabled").checked = settings.enabled;
  document.querySelector("#gameTreasury").value = settings.treasuryAddress || "";
  document.querySelector("#gameMinBet").value = settings.minBet;
  document.querySelector("#gameMaxBet").value = settings.maxBet;
  document.querySelector("#gameBetStep").value = settings.betStep;
  document.querySelector("#gameMinDeposit").value = settings.minDeposit;
  if (data.welcome) {
    document.querySelector("#welcomeEnabled").checked = data.welcome.enabled;
    document.querySelector("#welcomeAmount").value = data.welcome.amount;
    document.querySelector("#welcomeMinAda").value = Number(data.welcome.minLovelace) / 1e6;
    document.querySelector("#welcomeStats").textContent = ` Granted so far: ${formatAmount(data.welcome.granted)} wallets, ${formatAmount(data.welcome.total)} 300.`;
  }

  document.querySelector("#game-totals").replaceChildren(
    ...[
      ["Status", settings.enabled ? "Enabled" : "Paused"],
      ["Players", formatAmount(totals.accounts)],
      ["Deposited", `${formatAmount(totals.deposited)} 300`],
      ["Open balances", `${formatAmount(totals.balances)} 300`],
      ["Rounds", formatAmount(totals.rounds)],
      ["Bets", `${formatAmount(totals.bets)} 300`],
      ["Paid out", `${formatAmount(totals.payouts)} 300`],
      ["Last scan", describeScan(settings.lastScanAt, settings.lastScanResult)],
    ].map(([label, value]) => element("div", {}, [element("dt", { textContent: label }), element("dd", { textContent: value })])),
  );

  document.querySelector("#game-games").replaceChildren(
    element(
      "div",
      { className: "game-list" },
      data.games.map((game) => {
        const enabled = element("input", { type: "checkbox", checked: game.enabled });
        const payout = element("input", { value: String(game.payoutBps / 10000), inputMode: "decimal", required: true, className: "payout" });
        // Race games pay the odds of the dealt track; only the switch applies.
        const form = element("form", { className: "game-form" }, [
          element("label", { className: "checkbox" }, [enabled, " on"]),
          game.kind === "race" ? element("span", { className: "muted", textContent: "odds from the track" }) : element("label", { className: "inline" }, [payout, "×"]),
          element("button", { type: "submit", textContent: "Save" }),
        ]);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          await runGameAction({ action: "game", id: game.id, enabled: enabled.checked, payout: payout.value.trim().replace(",", ".") }, `${game.name} saved.`);
        });
        return element("div", { className: "game-row" }, [
          element("span", {}, [
            element("strong", { textContent: game.name }),
            element("span", {
              className: "muted",
              textContent: ` · ${game.outcomes} outcomes · ${formatAmount(game.rounds)} rounds · ${formatAmount(game.bets)} bet · ${formatAmount(game.payouts)} paid`,
            }),
          ]),
          form,
        ]);
      }),
    ),
  );

  const unmatched = document.querySelector("#game-unmatched");
  unmatched.replaceChildren(
    data.unmatched.length
      ? element(
          "div",
          { className: "game-list" },
          data.unmatched.map((transfer) => {
            const wallet = element("input", { placeholder: "Sender wallet (stake1… or addr1…)", required: true });
            const form = element("form", {}, [wallet, element("button", { type: "submit", textContent: "Assign" })]);
            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              await runGameAction({ action: "assign", txHash: transfer.tx_hash, wallet: wallet.value }, "Transfer assigned.");
            });
            return element("div", { className: "game-row" }, [
              element("span", { textContent: `${formatAmount(transfer.quantity)} 300` }),
              txLink(transfer.tx_hash),
              form,
            ]);
          }),
        )
      : element("p", { className: "hint", textContent: "Nothing to assign." }),
  );

  const deposits = document.querySelector("#game-deposits");
  deposits.replaceChildren(
    data.deposits.length
      ? element(
          "div",
          { className: "game-list" },
          data.deposits.map((deposit) =>
            element("div", { className: "game-row" }, [
              element("span", {}, [
                element("strong", { textContent: `${formatAmount(deposit.received ?? deposit.requested)} 300` }),
                element("span", { className: "muted", textContent: ` · ${deposit.status} · ${new Date(deposit.created_at).toLocaleString()}` }),
              ]),
              deposit.tx_hash ? txLink(deposit.tx_hash) : element("span", { className: "muted", textContent: "no tx yet" }),
              element("code", { textContent: shorten(deposit.wallet), title: deposit.wallet }),
            ]),
          ),
        )
      : element("p", { className: "hint", textContent: "No deposits yet." }),
  );
};

const runGameAction = async (body, success) => {
  message.textContent = "Working…";
  try {
    const data = await gameRequest(body);
    renderGame(data);
    message.textContent = data.scan
      ? `Scan finished: ${data.scan.credited} credited, ${data.scan.unmatched} unassigned, ${data.scan.pending} still confirming.`
      : success;
  } catch (error) {
    message.textContent = error.message;
  }
};

const loadGame = async () => {
  gamePanel.hidden = false;
  try {
    renderGame(await gameRequest());
  } catch (error) {
    document.querySelector("#game-totals").replaceChildren(element("p", { className: "hint", textContent: `Game data unavailable: ${error.message}` }));
  }
};

document.querySelector("#game-settings").addEventListener("submit", (event) => {
  event.preventDefault();
  runGameAction(
    {
      action: "settings",
      enabled: document.querySelector("#gameEnabled").checked,
      treasuryAddress: document.querySelector("#gameTreasury").value.trim(),
      minBet: document.querySelector("#gameMinBet").value.trim(),
      maxBet: document.querySelector("#gameMaxBet").value.trim(),
      betStep: document.querySelector("#gameBetStep").value.trim(),
      minDeposit: document.querySelector("#gameMinDeposit").value.trim(),
    },
    "Game settings saved.",
  );
});
document.querySelector("#game-welcome").addEventListener("submit", (event) => {
  event.preventDefault();
  runGameAction(
    {
      action: "welcome",
      enabled: document.querySelector("#welcomeEnabled").checked,
      amount: document.querySelector("#welcomeAmount").value.trim(),
      minAda: document.querySelector("#welcomeMinAda").value.trim(),
    },
    "Starting credit saved.",
  );
});
document.querySelector("#game-adjust").addEventListener("submit", (event) => {
  event.preventDefault();
  runGameAction(
    {
      action: "adjust",
      wallet: document.querySelector("#adjustWallet").value.trim(),
      delta: document.querySelector("#adjustDelta").value.trim().replace("−", "-"),
      note: document.querySelector("#adjustNote").value.trim(),
    },
    "Correction applied.",
  );
});
document.querySelector("#game-scan").addEventListener("click", () => runGameAction({ action: "scan" }, "Scan finished."));
const showEditor = async () => {
  loginPanel.hidden = true;
  loadGame();
  // The content form stays hidden if loading fails, so it can never save empty fields.
  try {
    const content = await request("/api/admin/content");
    for (const key of fields)
      document.querySelector(`#${key}`).value = content[key] || "";
    editorPanel.hidden = false;
  } catch (error) {
    message.textContent = `Homepage content unavailable: ${error.message}`;
  }
};
document
  .querySelector("#login-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Signing in…";
    try {
      await request("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: document.querySelector("#password").value,
        }),
      });
      document.querySelector("#password").value = "";
      await showEditor();
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
    }
  });
document
  .querySelector("#content-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Saving…";
    try {
      const body = Object.fromEntries(
        fields.map((key) => [key, document.querySelector(`#${key}`).value]),
      );
      await request("/api/admin/content", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      message.textContent = "Saved. The live homepage has been updated.";
    } catch (error) {
      message.textContent = error.message;
    }
  });

document.querySelector("#logout").addEventListener("click", async () => {
  await request("/api/admin/session", { method: "DELETE" });
  showLogin();
  message.textContent = "Signed out.";
});
request("/api/admin/session")
  .then((session) => {
    // The password form only appears while password login is still enabled.
    document.querySelector("#login-form").hidden = !session.passwordLogin;
    document.querySelector("#signed-in-as").textContent = session.wallet
      ? `Signed in with wallet ${session.wallet.slice(0, 14)}…${session.wallet.slice(-6)}`
      : "";
    return session.authenticated ? showEditor() : showLogin();
  })
  .catch((error) => {
    showLogin();
    message.textContent = error.message;
  });
