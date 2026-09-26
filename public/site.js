const dash = "–";

const formatCompact = (value, digits = 1) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(Number(value))
  : dash;

const formatAda = (lovelace) => {
  if (lovelace === null || lovelace === undefined || lovelace === "") return dash;
  const ada = Number(lovelace) / 1_000_000;
  return Number.isFinite(ada) ? `${formatCompact(ada, 1)} ADA` : dash;
};

const formatPercent = (value) => {
  if (value === null || value === undefined || value === "") return dash;
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(number >= 10 ? 0 : 2)}%` : dash;
};

const formatMargin = (value) => {
  if (value === null || value === undefined || value === "") return dash;
  const number = Number(value);
  const percent = number * 100;
  return Number.isFinite(percent) ? `${percent.toFixed(percent >= 10 ? 0 : 2)}%` : dash;
};

const setAll = (selector, value) => {
  if (value === undefined || value === null || value === "") return;
  document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
};

const updateLiveData = async () => {
  const response = await fetch("/api/metrics", { cache: "no-store" });
  if (!response.ok) throw new Error("Live metrics unavailable");
  const data = await response.json();
  const pool = data.pool || {};
  const drep = data.drep || {};

  setAll('[data-spo-live="blocks"]', pool.blockCount ? formatCompact(pool.blockCount, 0) : dash);
  setAll('[data-spo-live="stake"]', formatAda(pool.liveStakeLovelace));
  setAll('[data-spo-live="delegators"]', pool.liveDelegators ?? dash);
  setAll('[data-spo-live="saturation"]', formatPercent(pool.liveSaturation));
  setAll('[data-spo-live="status"]', pool.status || dash);
  setAll('[data-spo-live="margin"]', formatMargin(pool.margin));
  setAll('[data-spo-live="fixed"]', formatAda(pool.fixedCostLovelace));
  setAll('[data-spo-live="pledge"]', formatAda(pool.pledgeLovelace));
  setAll('[data-drep-live="amount"]', formatAda(drep.amountLovelace));
  setAll('[data-drep-live="status"]', drep.status || dash);

  if (data.updatedAt) {
    const updated = new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setAll('[data-spo-live="updated"]', `Updated ${updated}`);
  }
  window.setArrivalHeight?.(Number(data.chain?.blockHeight));
};

const setupWalletMenu = () => {
  document.querySelectorAll(".wallet-connect").forEach((host) => {
    const button = host.querySelector(".wallet-connect-button");
    const buttonLabel = button?.querySelector("span");
    if (!button || !buttonLabel) return;

    const menu = document.createElement("div");
    menu.className = "wallet-menu";
    menu.hidden = true;
    menu.innerHTML = '<strong>Connect a Cardano wallet</strong><span class="wallet-help"></span><div class="wallet-options"></div><span class="wallet-status" role="status"></span>';
    const providers = Object.entries(window.cardano || {}).filter(([, provider]) => typeof provider?.enable === "function");
    const help = menu.querySelector(".wallet-help");
    const options = menu.querySelector(".wallet-options");
    const status = menu.querySelector(".wallet-status");

    if (providers.length) {
      help.textContent = "Choose an installed wallet. You will approve the connection inside your wallet.";
      providers.forEach(([key, provider]) => {
        const walletButton = document.createElement("button");
        walletButton.type = "button";
        walletButton.textContent = provider.name || key;
        walletButton.addEventListener("click", async () => {
          status.textContent = `Connecting to ${provider.name || key}…`;
          try {
            const api = await provider.enable();
            await api.getNetworkId();
            window.cardano300Wallet = api;
            buttonLabel.textContent = `Connected: ${provider.name || key}`;
            status.textContent = "Wallet connected successfully.";
          } catch (error) {
            status.textContent = error?.message || "The connection was cancelled.";
          }
        });
        options.appendChild(walletButton);
      });
    } else {
      help.textContent = "No Cardano wallet extension was detected. Install one, then reload this page.";
      options.innerHTML = '<a href="https://www.lace.io/" target="_blank" rel="noreferrer">Install Lace ↗</a><a href="https://eternl.io/" target="_blank" rel="noreferrer">Install Eternl ↗</a>';
    }

    host.appendChild(menu);
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!open));
      menu.hidden = open;
    });
    document.addEventListener("click", (event) => {
      if (!host.contains(event.target)) {
        button.setAttribute("aria-expanded", "false");
        menu.hidden = true;
      }
    });
  });
};

const setupCopyButtons = () => {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = original; }, 1600);
      } catch {
        button.textContent = "Copy failed";
      }
    });
  });
};

const setupBlockArrivals = () => {
  const stream = document.querySelector(".arrival-stream");
  if (!stream) return;
  const rewards = [170, 170, 340, 170, 170, 340];
  let currentHeight = 13_668_419;
  let arrivalIndex = 0;

  const blockState = (stage) => stage.startsWith("confirmed")
    ? { label: "Confirmed", icon: "✓" }
    : stage === "unpacked"
      ? { label: "Latest arrival", icon: "●" }
      : { label: "Incoming", icon: "→" };

  const updateBlockState = (block, stage) => {
    if (!block) return;
    const state = blockState(stage);
    const badge = block.querySelector(".arrival-cube em");
    const status = block.querySelector(".arrival-block-status");
    if (badge) badge.textContent = state.icon;
    if (status) status.innerHTML = `<i>${state.icon}</i>${state.label}`;
  };

  const createBlock = (height, stage) => {
    const block = document.createElement("div");
    block.className = `arrival-live-block stage-${stage}`;
    block.dataset.height = String(height);
    const state = blockState(stage);
    block.innerHTML = `
      <span class="arrival-height"><small>Block</small>#${height}</span>
      <div class="arrival-cube">
        <span class="cube-top"></span>
        <span class="cube-front"><b>300</b></span>
        <span class="cube-side"><i></i></span>
        <em>${state.icon}</em>
      </div>
      <span class="arrival-block-status"><i>${state.icon}</i>${state.label}</span>
      <strong class="arrival-reward"></strong>`;
    return block;
  };

  const showReward = (block, amount) => {
    if (!block) return;
    block.querySelector(".arrival-reward").textContent = `+${amount} ADA`;
    block.classList.remove("is-unpacking");
    requestAnimationFrame(() => block.classList.add("is-unpacking"));
    window.setTimeout(() => block.classList.remove("is-unpacking"), 3000);
  };

  const render = () => {
    stream.replaceChildren(
      createBlock(currentHeight - 2, "confirmed-old"),
      createBlock(currentHeight - 1, "confirmed-new"),
      createBlock(currentHeight, "unpacked"),
      createBlock(currentHeight + 1, "next"),
    );
    window.setTimeout(() => showReward(stream.querySelector(".stage-unpacked"), rewards[arrivalIndex % rewards.length]), 500);
  };

  const advance = () => {
    const oldest = stream.querySelector(".stage-confirmed-old");
    const confirmed = stream.querySelector(".stage-confirmed-new");
    const unpacked = stream.querySelector(".stage-unpacked");
    const next = stream.querySelector(".stage-next");
    oldest?.remove();
    confirmed?.classList.replace("stage-confirmed-new", "stage-confirmed-old");
    unpacked?.classList.replace("stage-unpacked", "stage-confirmed-new");
    next?.classList.replace("stage-next", "stage-unpacked");
    updateBlockState(confirmed, "confirmed-old");
    updateBlockState(unpacked, "confirmed-new");
    updateBlockState(next, "unpacked");
    currentHeight += 1;
    arrivalIndex += 1;
    const cycle = document.querySelector(".arrival-cycle");
    cycle?.classList.remove("is-resetting");
    requestAnimationFrame(() => cycle?.classList.add("is-resetting"));
    const incoming = createBlock(currentHeight + 1, "incoming");
    stream.appendChild(incoming);
    requestAnimationFrame(() => incoming.classList.replace("stage-incoming", "stage-next"));
    window.setTimeout(() => showReward(next, rewards[arrivalIndex % rewards.length]), 1500);
  };

  window.setArrivalHeight = (height) => {
    if (!Number.isFinite(height) || height <= 0) return;
    currentHeight = Math.floor(height);
    arrivalIndex = 0;
    render();
  };
  render();
  window.setInterval(advance, 7000);
};

setupWalletMenu();
setupCopyButtons();
setupBlockArrivals();
updateLiveData().catch(() => {});
