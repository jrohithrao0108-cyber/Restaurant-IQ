export type KotItem = {
  name: string;
  qty: number;
  notes?: string;
  category?: string;
};

export type KotPrintOptions = {
  restaurantName?: string;
  orderNumber: string;
  table?: string;
  source: string;
  items: KotItem[];
  kotNumber?: number | string;
  serverName?: string;
  timestamp?: string | Date;
  paperWidth?: "80mm" | "58mm";
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function printKitchenOrderTicket(options: KotPrintOptions): boolean {
  if (!options.items || options.items.length === 0) {
    alert("No items to send to kitchen.");
    return false;
  }

  const paperWidth = options.paperWidth || "80mm";
  const is58mm = paperWidth === "58mm";

  const printWindow = window.open(
    "",
    "restaurant-kot",
    "width=420,height=600"
  );

  if (!printWindow) {
    alert("Please allow pop-ups to print the Kitchen Order Ticket (KOT).");
    return false;
  }

  const dateObj = options.timestamp
    ? new Date(options.timestamp)
    : new Date();

  const formattedTime = dateObj.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const formattedDate = dateObj.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const isDineIn = options.source === "DINE_IN";
  const destinationBadge = isDineIn
    ? `TABLE ${options.table?.trim() || "N/A"}`
    : options.source.toUpperCase();

  const totalItemsCount = options.items.reduce(
    (sum, item) => sum + item.qty,
    0
  );

  const itemRows = options.items
    .map(
      (item) => `
      <div class="kot-item">
        <div class="kot-qty">${item.qty}</div>
        <div class="kot-item-details">
          <span class="kot-name">${escapeHtml(item.name)}</span>
          ${
            item.notes && item.notes.trim()
              ? `<div class="kot-note">*** Note: ${escapeHtml(item.notes.trim())} ***</div>`
              : ""
          }
        </div>
      </div>
    `
    )
    .join("");

  const kotTitle = options.kotNumber
    ? `KOT #${options.kotNumber}`
    : "KITCHEN ORDER TICKET";

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(kotTitle)} - ${escapeHtml(destinationBadge)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page {
            size: ${paperWidth} auto;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: "Courier New", Courier, monospace, system-ui, sans-serif;
            font-size: ${is58mm ? "11px" : "13px"};
            line-height: 1.3;
          }
          .kot-container {
            width: 100%;
            max-width: ${paperWidth};
            margin: 0 auto;
            padding: ${is58mm ? "4px 2px" : "8px 6px"};
          }
          .kot-badge {
            text-align: center;
            border: 2px solid #000;
            padding: 4px;
            font-size: ${is58mm ? "16px" : "20px"};
            font-weight: 900;
            letter-spacing: 1px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }
          .kot-header {
            text-align: center;
            border-bottom: 1px dashed #000;
            padding-bottom: 4px;
            margin-bottom: 6px;
          }
          .kot-header h2 {
            margin: 0;
            font-size: ${is58mm ? "13px" : "15px"};
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .kot-meta {
            display: flex;
            justify-content: space-between;
            font-size: ${is58mm ? "10px" : "11.5px"};
            margin: 2px 0;
            font-weight: 600;
          }
          .divider {
            border-bottom: 1px dashed #000;
            margin: 6px 0;
          }
          .kot-items-header {
            display: flex;
            font-weight: 900;
            border-bottom: 1px solid #000;
            padding-bottom: 3px;
            margin-bottom: 6px;
            text-transform: uppercase;
            font-size: ${is58mm ? "11px" : "12px"};
          }
          .kot-item {
            display: flex;
            align-items: flex-start;
            padding: 4px 0;
            border-bottom: 1px dotted #888;
          }
          .kot-qty {
            width: ${is58mm ? "28px" : "36px"};
            font-size: ${is58mm ? "15px" : "18px"};
            font-weight: 900;
            text-align: center;
            flex-shrink: 0;
            line-height: 1;
          }
          .kot-item-details {
            flex-grow: 1;
            padding-left: 4px;
          }
          .kot-name {
            font-size: ${is58mm ? "12.5px" : "14px"};
            font-weight: 800;
            display: block;
            word-break: break-word;
          }
          .kot-note {
            margin-top: 2px;
            font-size: ${is58mm ? "10px" : "11.5px"};
            font-weight: 900;
            color: #000;
            background: #eee;
            padding: 2px 4px;
            display: inline-block;
            border-radius: 2px;
          }
          .kot-footer {
            border-top: 1px dashed #000;
            margin-top: 8px;
            padding-top: 6px;
            display: flex;
            justify-content: space-between;
            font-weight: 800;
            font-size: ${is58mm ? "11px" : "12px"};
          }
          @media print {
            body { padding: 0; }
            .kot-container { width: 100%; max-width: 100%; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="kot-container">
          <div class="kot-badge">${escapeHtml(destinationBadge)}</div>
          <div class="kot-header">
            <h2>${escapeHtml(kotTitle)}</h2>
            ${options.restaurantName ? `<div>${escapeHtml(options.restaurantName)}</div>` : ""}
          </div>
          <div class="kot-meta">
            <span>Order: #${escapeHtml(options.orderNumber)}</span>
            <span>${escapeHtml(formattedTime)}</span>
          </div>
          <div class="kot-meta">
            <span>Date: ${escapeHtml(formattedDate)}</span>
            ${options.serverName ? `<span>Server: ${escapeHtml(options.serverName)}</span>` : ""}
          </div>
          <div class="divider"></div>
          <div class="kot-items-header">
            <span style="width: ${is58mm ? "28px" : "36px"}; text-align: center;">QTY</span>
            <span style="flex-grow: 1; padding-left: 4px;">ITEM</span>
          </div>
          ${itemRows}
          <div class="kot-footer">
            <span>TOTAL ITEMS</span>
            <span>${totalItemsCount}</span>
          </div>
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.onafterprint = () => printWindow.close();
  window.setTimeout(() => {
    printWindow.print();
  }, 250);

  return true;
}
