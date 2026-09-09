export type ReceiptItem = {
  name: string;
  qty: number;
  price: number;
};

export type ReceiptPrintOptions = {
  restaurantName: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
  gstin?: string;
  fssai?: string;
  orderNumber: string;
  table?: string;
  source: string;
  paymentMode: string;
  items: ReceiptItem[];
  subtotal?: number;
  taxCgstPercent?: number;
  taxSgstPercent?: number;
  discountAmount?: number;
  total: number;
  timestamp?: string | Date;
  isReprint?: boolean;
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

function formatMoney(amount: number): string {
  return "₹" + Math.round(amount).toLocaleString("en-IN");
}

export function printCustomerBillReceipt(
  options: ReceiptPrintOptions
): boolean {
  if (!options.items || options.items.length === 0) {
    alert("Please select at least one item before printing.");
    return false;
  }

  const paperWidth = options.paperWidth || "80mm";
  const is58mm = paperWidth === "58mm";

  const billWindow = window.open(
    "",
    options.isReprint ? "restaurant-reprint-bill" : "restaurant-bill",
    "width=420,height=720"
  );

  if (!billWindow) {
    alert("Please allow pop-ups to print the bill.");
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

  const calculatedSubtotal =
    options.subtotal !== undefined
      ? options.subtotal
      : options.items.reduce(
          (sum, item) => sum + item.price * item.qty,
          0
        );

  const discount = options.discountAmount || 0;
  const taxableAmount = Math.max(0, calculatedSubtotal - discount);

  const cgstRate = options.taxCgstPercent || 0;
  const sgstRate = options.taxSgstPercent || 0;
  const cgstAmount = cgstRate > 0 ? (taxableAmount * cgstRate) / 100 : 0;
  const sgstAmount = sgstRate > 0 ? (taxableAmount * sgstRate) / 100 : 0;

  const finalTotal =
    options.total !== undefined
      ? options.total
      : Math.round(taxableAmount + cgstAmount + sgstAmount);

  const itemRows = options.items
    .map(
      (item) => `
      <tr>
        <td>
          ${escapeHtml(item.name)}
          <small>${item.qty} × ${formatMoney(item.price)}</small>
        </td>
        <td>${formatMoney(item.price * item.qty)}</td>
      </tr>
    `
    )
    .join("");

  const destinationBadge =
    options.source === "DINE_IN"
      ? options.table
        ? `Table ${escapeHtml(options.table.trim())}`
        : "Dine-In"
      : escapeHtml(options.source);

  billWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${options.isReprint ? "Reprint - " : ""}Bill #${escapeHtml(options.orderNumber)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page {
            size: ${paperWidth} auto;
            margin: 2mm 0;
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
            font-size: ${is58mm ? "11px" : "12px"};
            line-height: 1.35;
          }
          .receipt {
            width: 100%;
            max-width: ${paperWidth};
            margin: 0 auto;
            padding: ${is58mm ? "4px 2px" : "6px 4px"};
          }
          header {
            text-align: center;
            border-bottom: 1px dashed #000;
            padding-bottom: 6px;
            margin-bottom: 6px;
          }
          h1 {
            margin: 0 0 3px;
            font-size: ${is58mm ? "14px" : "16px"};
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            word-break: break-word;
          }
          header p {
            margin: 1px 0;
            font-size: ${is58mm ? "9.5px" : "11px"};
            color: #000;
          }
          .reprint-badge {
            display: inline-block;
            border: 1px solid #000;
            font-size: 10px;
            font-weight: 900;
            padding: 1px 6px;
            margin-top: 3px;
            text-transform: uppercase;
          }
          .meta {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 4px;
            margin: 4px 0;
            font-size: ${is58mm ? "10px" : "11px"};
            font-weight: 700;
          }
          .divider {
            border-bottom: 1px dashed #000;
            margin: 4px 0;
          }
          table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            margin: 4px 0;
          }
          th {
            font-size: ${is58mm ? "10px" : "11px"};
            text-align: left;
            border-bottom: 1px solid #000;
            padding-bottom: 3px;
            text-transform: uppercase;
          }
          th:last-child {
            text-align: right;
          }
          td {
            padding: 4px 0;
            border-bottom: 1px dotted #bbb;
            vertical-align: top;
            font-size: ${is58mm ? "10.5px" : "11.5px"};
          }
          td:first-child {
            width: 68%;
            word-break: break-word;
            padding-right: 4px;
          }
          td:last-child {
            width: 32%;
            text-align: right;
            white-space: nowrap;
            font-weight: 700;
          }
          small {
            display: block;
            color: #222;
            margin-top: 1px;
            font-size: ${is58mm ? "9px" : "10px"};
            font-weight: normal;
          }
          .calc-row {
            display: flex;
            justify-content: space-between;
            font-size: ${is58mm ? "10.5px" : "11.5px"};
            padding: 2px 0;
          }
          .total {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            margin-top: 4px;
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
            font-size: ${is58mm ? "13px" : "15px"};
            font-weight: 900;
          }
          footer {
            text-align: center;
            margin-top: 8px;
            padding-top: 4px;
            font-size: ${is58mm ? "9px" : "10px"};
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          @media print {
            body { padding: 0; }
            .receipt { width: 100%; max-width: 100%; padding: 0; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header>
            <h1>${escapeHtml(options.restaurantName || "Restaurant")}</h1>
            ${options.restaurantAddress ? `<p>${escapeHtml(options.restaurantAddress)}</p>` : ""}
            ${options.restaurantPhone ? `<p>Ph: ${escapeHtml(options.restaurantPhone)}</p>` : ""}
            ${options.gstin ? `<p>GSTIN: ${escapeHtml(options.gstin)}</p>` : ""}
            ${options.fssai ? `<p>FSSAI: ${escapeHtml(options.fssai)}</p>` : ""}
            <p style="margin-top: 3px; font-weight: 700;">
              ${options.isReprint ? "DUPLICATE BILL" : "TAX INVOICE / RETAIL BILL"}
            </p>
            ${options.isReprint ? `<div class="reprint-badge">Reprint</div>` : ""}
          </header>

          <div class="meta">
            <span>Bill: #${escapeHtml(options.orderNumber)}</span>
            <span>${escapeHtml(formattedTime)}</span>
          </div>
          <div class="meta">
            <span>Date: ${escapeHtml(formattedDate)}</span>
            <span>Mode: ${escapeHtml(options.paymentMode)}</span>
          </div>
          <div class="meta">
            <span>Channel: ${destinationBadge}</span>
          </div>

          <div class="divider"></div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Amt</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <div class="divider"></div>

          ${
            discount > 0 || cgstRate > 0 || sgstRate > 0
              ? `
            <div class="calc-row">
              <span>Subtotal:</span>
              <span>${formatMoney(calculatedSubtotal)}</span>
            </div>
            ${
              discount > 0
                ? `<div class="calc-row">
                    <span>Discount:</span>
                    <span>-${formatMoney(discount)}</span>
                  </div>`
                : ""
            }
            ${
              cgstRate > 0
                ? `<div class="calc-row">
                    <span>CGST (${cgstRate}%):</span>
                    <span>${formatMoney(cgstAmount)}</span>
                  </div>`
                : ""
            }
            ${
              sgstRate > 0
                ? `<div class="calc-row">
                    <span>SGST (${sgstRate}%):</span>
                    <span>${formatMoney(sgstAmount)}</span>
                  </div>`
                : ""
            }
          `
              : ""
          }

          <div class="total">
            <span>Grand Total</span>
            <span>${formatMoney(finalTotal)}</span>
          </div>

          <footer>
            <p>Thank you for dining with us!</p>
            <p>Please visit again</p>
          </footer>
        </main>
      </body>
    </html>
  `);

  billWindow.document.close();
  billWindow.focus();
  billWindow.onafterprint = () => billWindow.close();
  window.setTimeout(() => {
    billWindow.print();
  }, 250);

  return true;
}
