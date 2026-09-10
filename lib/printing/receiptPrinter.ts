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
  billNo?: string | number;
  tokenNo?: string | number;
  table?: string;
  source: string;
  paymentMode: string;
  customerName?: string;
  cashierName?: string;
  serverName?: string;
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

function formatDecimal(amount: number): string {
  return Number(amount || 0).toFixed(2);
}

export function printCustomerBillReceipt(
  options: ReceiptPrintOptions
): boolean {
  if (!options.items || options.items.length === 0) {
    console.warn("Please select at least one item before printing.");
    return false;
  }

  const paperWidth = options.paperWidth || "80mm";
  const is58mm = paperWidth === "58mm";

  const winName = `bill_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const billWindow = window.open("", winName, "width=420,height=720");

  if (!billWindow) {
    console.warn("Pop-up blocked for printing bill receipt.");
    return false;
  }

  const dateObj = options.timestamp
    ? new Date(options.timestamp)
    : new Date();

  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yy = String(dateObj.getFullYear()).slice(-2);
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  const formattedDateTime = `${dd}/${mm}/${yy} ${hh}:${min}`;

  const cleanOrderNum = options.orderNumber.replace(/^(BILL-|ORD-|KOT-|OFF-)/i, "");
  const billNo =
    options.billNo !== undefined && options.billNo !== null
      ? String(options.billNo)
      : cleanOrderNum.slice(-4) || cleanOrderNum;
  const tokenNo =
    options.tokenNo !== undefined && options.tokenNo !== null
      ? String(options.tokenNo)
      : billNo;

  const cashier = options.cashierName || options.serverName || "biller";
  const orderChannel =
    options.source === "DINE_IN"
      ? options.table
        ? `Dine In • ${options.table.trim()}`
        : "Dine In"
      : options.source === "TAKEAWAY"
      ? "Take Away"
      : options.source === "SWIGGY"
      ? "Swiggy"
      : options.source === "ZOMATO"
      ? "Zomato"
      : escapeHtml(options.source);

  const calculatedSubtotal =
    options.subtotal !== undefined
      ? options.subtotal
      : options.items.reduce(
          (sum, item) => sum + item.price * item.qty,
          0
        );

  const totalQty = options.items.reduce(
    (sum, item) => sum + (Number(item.qty) || 0),
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
        <td class="td-item">${escapeHtml(item.name)}</td>
        <td class="td-qty">${item.qty}</td>
        <td class="td-price">${formatDecimal(item.price)}</td>
        <td class="td-amount">${formatDecimal(item.price * item.qty)}</td>
      </tr>
    `
    )
    .join("");

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
            font-family: "Courier New", Courier, monospace;
            font-size: ${is58mm ? "11px" : "12px"};
            line-height: 1.32;
            font-weight: 600;
          }
          .receipt {
            width: 100%;
            max-width: ${paperWidth};
            margin: 0 auto;
            padding: ${is58mm ? "3px 2px" : "5px 6px"};
          }
          .header {
            text-align: center;
            margin-bottom: 3px;
          }
          .header h1 {
            margin: 0 0 2px 0;
            font-size: ${is58mm ? "13px" : "15px"};
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            word-break: break-word;
          }
          .header p {
            margin: 1px 0;
            font-size: ${is58mm ? "9.5px" : "11px"};
            font-weight: 600;
            color: #000;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 4px 0;
          }
          .name-line {
            font-size: ${is58mm ? "10.5px" : "11.5px"};
            font-weight: 600;
            padding: 1px 0;
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: ${is58mm ? "10px" : "11px"};
            padding: 1px 0;
            font-weight: 600;
          }
          .token-row {
            font-size: ${is58mm ? "11.5px" : "12.5px"};
            font-weight: 900;
            margin-top: 1px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 3px 0;
          }
          th {
            font-size: ${is58mm ? "10px" : "11px"};
            font-weight: 900;
            padding: 3px 0;
            text-align: left;
            border-bottom: 1px dashed #000;
          }
          th.th-qty { text-align: center; width: 14%; }
          th.th-price { text-align: right; width: 22%; }
          th.th-amount { text-align: right; width: 24%; }
          th.th-item { width: 40%; }
          td {
            padding: 2.5px 0;
            font-size: ${is58mm ? "10px" : "11.5px"};
            vertical-align: top;
            font-weight: 600;
          }
          td.td-item { width: 40%; word-break: break-word; padding-right: 2px; }
          td.td-qty { text-align: center; width: 14%; }
          td.td-price { text-align: right; width: 22%; white-space: nowrap; }
          td.td-amount { text-align: right; width: 24%; white-space: nowrap; }
          .totals-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: ${is58mm ? "10.5px" : "11.5px"};
            padding: 1.5px 0;
            font-weight: 600;
          }
          .grand-total-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: ${is58mm ? "13px" : "14.5px"};
            font-weight: 900;
            padding: 3px 0;
          }
          .footer {
            text-align: center;
            font-size: ${is58mm ? "10px" : "11px"};
            font-weight: 900;
            letter-spacing: 0.5px;
            padding: 4px 0 2px 0;
            text-transform: uppercase;
          }
          @media print {
            body { padding: 0; }
            .receipt { width: 100%; max-width: 100%; padding: 0; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <div class="header">
            <h1>${escapeHtml(options.restaurantName || "Restaurant")}</h1>
            ${options.restaurantAddress ? `<p>${escapeHtml(options.restaurantAddress)}</p>` : ""}
            ${options.restaurantPhone ? `<p>Ph: ${escapeHtml(options.restaurantPhone)}</p>` : ""}
            ${options.gstin ? `<p>GSTIN: ${escapeHtml(options.gstin)}</p>` : ""}
            ${options.fssai ? `<p>FSSAI: ${escapeHtml(options.fssai)}</p>` : ""}
          </div>

          <div class="divider"></div>

          <div class="name-line">
            Name: ${options.customerName ? escapeHtml(options.customerName) : ""}
          </div>

          <div class="divider"></div>

          <div class="meta-row">
            <span>Date: ${escapeHtml(formattedDateTime)}</span>
            <span>${orderChannel}</span>
          </div>
          <div class="meta-row">
            <span>Cashier: ${escapeHtml(cashier)}</span>
            <span>Bill No.: ${escapeHtml(billNo)}</span>
          </div>
          <div class="meta-row token-row">
            <span>Token No.: ${escapeHtml(String(tokenNo))}</span>
          </div>

          <div class="divider"></div>

          <table>
            <thead>
              <tr>
                <th class="th-item">Item</th>
                <th class="th-qty">Qty.</th>
                <th class="th-price">Price</th>
                <th class="th-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <div class="divider"></div>

          <div class="totals-row">
            <span>Total Qty: ${totalQty}</span>
            <span>Sub Total&nbsp;&nbsp;${formatDecimal(calculatedSubtotal)}</span>
          </div>
          ${
            discount > 0
              ? `<div class="totals-row"><span>Discount</span><span>-${formatDecimal(discount)}</span></div>`
              : ""
          }
          ${
            cgstAmount > 0
              ? `<div class="totals-row"><span>CGST (${cgstRate}%)</span><span>${formatDecimal(cgstAmount)}</span></div>`
              : ""
          }
          ${
            sgstAmount > 0
              ? `<div class="totals-row"><span>SGST (${sgstRate}%)</span><span>${formatDecimal(sgstAmount)}</span></div>`
              : ""
          }

          <div class="divider"></div>

          <div class="grand-total-row">
            <span>Grand Total</span>
            <span>₹ ${formatDecimal(finalTotal)}</span>
          </div>

          <div class="divider"></div>

          <div class="footer">
            THANK YOU, VISIT AGAIN
          </div>
        </main>
      </body>
    </html>
  `);

  try {
    billWindow.document.close();
    billWindow.focus();
    billWindow.onafterprint = () => {
      try { billWindow.close(); } catch (e) {}
    };
    window.setTimeout(() => {
      try {
        billWindow.print();
      } catch (e) {
        console.warn("Print receipt dialog error:", e);
      }
    }, 250);
  } catch (err) {
    console.error("Failed to print receipt:", err);
  }

  return true;
}
