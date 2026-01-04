const orderIDRegEx = new RegExp('[D0-9\-]+');
const priceRegEx = new RegExp('[0-9,]+');
const orderDateRegEx = new RegExp('[0-9]+', 'g');

// the addon makes use of the session store, to keep order data from multiple 
// pages, and then export all as one file.

// addon is part of the existing page, we don't want to clash with other existing storage keys,
// so add our identifying prefixes below

// put an item in store per order. we store each order's details as json.
// each order can have one or more purchase item(s)
// store item key is "<prefix><order id>"
const STORE_KEY_ORDER_PREFIX = "HIST_ADDON_ORDER_";
// count of all orders fetched to store so far
const STORE_KEY_ORDER_COUNT = "HIST_ADDON_COUNT";
const STORE_KEY_DATE_MAX = 'HIST_ADDON_DATE_MAX';
const STORE_KEY_DATE_MIN = 'HIST_ADDON_DATE_MIN';

const CurrentPageStatus = Object.freeze({
  DEFAULT: 'DEFAULT',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED'
});

// global vars

let statusDiv = null;
let currPageStatus = CurrentPageStatus.DEFAULT;
let currPageOrderCount = 0;
let currPageOrderCountCancelled = 0;
let currPageItemCount = 0;

// the addon runs on the order history page. strangely, there isn't just one URL for it.
// depending on where you click from, Amazon JP may show order history at one of the several URLs. 
// that's why in the manifest, there are several URL match patterns:
// 1. click top nav bar => https://www.amazon.co.jp/gp/css/order-history...
// 2. click another page of history  => https://www.amazon.co.jp/your-orders/order...
// 3. click on another menu link like "Buy Again" then go back to the "Orders" page => https://www.amazon.co.jp/gp/your-account/order-history...
//
// to make life difficult, these pages have somewhat different DOM:
// #1 #2 have class "order-card", #3 doesn't; #2 #3 have one level of "js-order-card", #1 has two.
// so below is the solution:
// use "order-card" if exists (#1 #2)
// else use "js-order-card" (#3)
let orderCards = document.getElementsByClassName('order-card');
if (orderCards.length == 0) {
  orderCards = document.getElementsByClassName('js-order-card');
}
if (orderCards.length > 0) {
  const firstOrderCard = orderCards[0];
  const firstChild = firstOrderCard.firstChild;
  const gui = createActionGUI();
  statusDiv = gui.statusDiv;
  firstOrderCard.insertBefore(gui.actionContainerDiv, firstChild);
}  

// // DEBUG: don't know if it's problem with brower - content script just does not show up in debugger
// // use below to force showing it when need to debug
// debugger;

function createActionGUI() {
  let actionContainerDiv = document.createElement("div");
  actionContainerDiv.id = "downloadCSVDiv";
  addPadding(actionContainerDiv);

  let fetchButton = document.createElement('button');
  fetchButton.innerHTML = "Fetch Order Details";
  fetchButton.addEventListener("click", onClickFetchAllOrdersOnCurrentPage);
  actionContainerDiv.appendChild(fetchButton);
  addPadding(fetchButton);

  let downloadCSVButton = document.createElement('button');
  downloadCSVButton.innerHTML = 'Download CSV'
  downloadCSVButton.addEventListener('click', onClickDownloadCSV);
  actionContainerDiv.appendChild(downloadCSVButton);
  addPadding(downloadCSVButton)

  let resetButton = document.createElement('button');
  resetButton.innerHTML = 'Reset'
  resetButton.addEventListener('click', onClickReset);
  actionContainerDiv.appendChild(resetButton);
  addPadding(resetButton);

  let statusDiv = document.createElement('div');
  statusDiv.innerHTML = getStatusText();
  actionContainerDiv.appendChild(statusDiv);
  addPadding(statusDiv);

  return {
    actionContainerDiv: actionContainerDiv,
    statusDiv: statusDiv
  };
}

function addPadding(e) {
  e.style.margin = "0.2rem";
}

function getStatusText() {
  // if there is a count, then we have fetched something, so there must also be dates
  if (sessionStorage.getItem(STORE_KEY_ORDER_COUNT)) {
    return 'Total fetched order(s): ' + sessionStorage.getItem(STORE_KEY_ORDER_COUNT) + '. Date(s): ' 
      + sessionStorage.getItem(STORE_KEY_DATE_MIN) + ' to ' + sessionStorage.getItem(STORE_KEY_DATE_MAX) + '. '
      + getCurrPageStatusText();
  }
  return "Fetched order(s): 0";
}

function getCurrPageStatusText() {
  if (currPageStatus === CurrentPageStatus.COMPLETED) {
    let text = '<br/>Current page completed: ' + currPageOrderCount + ' order(s)';
    if (currPageOrderCountCancelled > 0) {
      text = text + ' (' + currPageOrderCountCancelled + ' cancelled)';
    }
    text = text + ' ' + currPageItemCount + ' items';
    return text;
  } else if (currPageStatus === CurrentPageStatus.PROCESSING) {
    return '<br/>Current page processing...';
  }
  return '';
}

async function onClickFetchAllOrdersOnCurrentPage() {
  console.log("start fetch");

  currPageStatus = CurrentPageStatus.PROCESSING;
  currPageOrderCount = 0;
  currPageOrderCountCancelled = 0;
  currPageItemCount = 0;

  const orderCardsArray = Array.from(orderCards);
  // // DEBUG
  // let testCount = 0;
  for (let orderCardElement of orderCardsArray) {
    const orderIDDiv = orderCardElement.getElementsByClassName('yohtmlc-order-id')[0];
    const orderIDDesc = orderIDDiv.textContent;
    const orderID = orderIDDesc.match(orderIDRegEx)[0];
    console.log(orderID);

    if (isCancelledOrder(orderCardElement)) {
      console.info("Cancelled order: " + orderID)
      ++currPageOrderCountCancelled;
      incOrderCount();
    } else {
      await fetchInvoicePage(orderID);
    }

    // // DEBUG: only get 2 orders for test
    // if (++testCount == 2) {
    //   console.log('debug end earlier');
    //   return;
    // }
  }
  currPageStatus = CurrentPageStatus.COMPLETED;
  statusDiv.innerHTML = getStatusText();

  console.log('fetch end');
}

function isCancelledOrder(orderCardElement) {
  const shipStatusText = orderCardElement.querySelector(".yohtmlc-shipment-status-primaryText")?.textContent;
  return shipStatusText && (shipStatusText.includes('キャンセル済み') || shipStatusText.includes('返品商品を受領済み'));
}

async function fetchInvoicePage(orderID) {
  const invoiceURLTemplate = 'https://www.amazon.co.jp/gp/css/summary/print.html/ref=oh_aui_ajax_invoice?ie=UTF8&orderID=';
  const invoiceURL = invoiceURLTemplate + orderID;

  console.log('Fetching invoice page: ' + invoiceURL);
  const response = await fetch (invoiceURL);
  if (response.status == 200) {
    const parser = new DOMParser();
    const responseText = await response.text();
    const dom = parser.parseFromString(responseText, "text/html");


    const orderDate = getOrderDateOnInvoicePage(dom);
    console.log('date: ' + orderDate);
    updateStoreMinMaxDate(orderDate);

    let orderDetails = {};
    orderDetails.id = orderID;
    orderDetails.date = orderDate;
    orderDetails.items = [];

    getOrderItemsOnInvoicePage(dom, orderDetails);

    sessionStorage.setItem(STORE_KEY_ORDER_PREFIX + orderDetails.id, JSON.stringify(orderDetails));
    incOrderCount();

    statusDiv.innerHTML = getStatusText();
  }
}

// we keep track of the current min and max date loaded, for display purpose
// call this to after loading all details for an order
function updateStoreMinMaxDate(newDate) {
  if (!sessionStorage.getItem(STORE_KEY_DATE_MIN)) {
    sessionStorage.setItem(STORE_KEY_DATE_MIN, newDate);
    sessionStorage.setItem(STORE_KEY_DATE_MAX, newDate);
    return;
  }
  let minDate = sessionStorage.getItem(STORE_KEY_DATE_MIN);
  if (newDate < minDate) {
    sessionStorage.setItem(STORE_KEY_DATE_MIN, newDate);
  }
  let maxDate = sessionStorage.getItem(STORE_KEY_DATE_MAX);
  if (newDate > maxDate) {
    sessionStorage.setItem(STORE_KEY_DATE_MAX, newDate);
  }
}


// we keep track of the total number of orders loaded, for display purpose
// call this to after loading all details for an order
function incOrderCount() {
  let orderCount = sessionStorage.getItem(STORE_KEY_ORDER_COUNT);
  if (!orderCount) {
    orderCount = 1;
  } else {
    orderCount = Number(orderCount) + 1;
  }
  sessionStorage.setItem(STORE_KEY_ORDER_COUNT, orderCount);

  ++currPageOrderCount;
}

function getOrderItemsOnInvoicePage(pageDom, orderDetails) {

  // the item nesting is not consistent.
  // sometimes it can be a single div[data-component="purchasedItems"] containing multiple items,
  // but sometimes it can multiple divs of "purchasedItems"
  // so just ignore the specific nesting, just get the list of grids

  // most of the required details are in the right grid (the purchase item details),
  // but annoyingly for multiple quantity the value is only in the left grid (the purhcase item image).
  // so need to get both, and sanity check that both grids have same number of rows.
  const productRowsLeft = pageDom.querySelectorAll('div[data-component="purchasedItemsLeftGrid"]');
  const productRowsRight = pageDom.querySelectorAll('div[data-component="purchasedItemsRightGrid"]');

  if (!productRowsLeft || !productRowsRight) {
    throw 'Purchased item not found in order';
  }
  if (productRowsLeft.length != productRowsRight.length) {
    throw 'Purchased item left and right rows not matching';
  }

  for (let i = 0; i < productRowsRight.length; ++i) {

    const productRow = productRowsRight[i];
    const productName = productRow.querySelector('div[data-component="itemTitle"]').textContent.trim();

    const productPriceMatch = productRow.querySelector('div[data-component="unitPrice"]').textContent.match(priceRegEx);
    // for a returned item, it will still show up as an item line, but without a price
    if (!productPriceMatch || productPriceMatch.length != 1) {
      console.log("No price for item: " + productName);
      continue;
    }
    // extract the price and strip thousand comma sep
    const productPrice = Number(productPriceMatch[0].replace(',', ''));

    // price is per unit. by default qty is 1, but if > 1, the page shows a tiny number below the product image. so try extract it.
    // NB: there is a [data-component=quantity], but it is blank, so can't use it.
    const productImageElem = productRowsLeft[i].querySelector('div[data-component="itemImage"]');
    const multiQty = productImageElem.querySelector('.od-item-view-qty')?.textContent.trim();
    const productCount = multiQty ? Number(multiQty) : 1;

    const productTotalPrice = productPrice * productCount;

    // if more than 1, then add a count suffix
    const countSuffix = productCount > 1 ? (' x' + productCount) : '';
    const productNameDetails = productName + countSuffix;

    console.log('name: ' + productNameDetails + ' price: ' + productTotalPrice);

    let orderItem = {}
    orderItem.name = productNameDetails;
    orderItem.price = productTotalPrice;

    orderDetails.items.push(orderItem);
    ++currPageItemCount;
  }
}

function getOrderDateElement(pageDom) {
  var dateElem = pageDom.querySelector('div[data-component="orderDate"]');
  if (dateElem) {
    return dateElem;
  }
  throw 'No date found';
}

function getOrderDateOnInvoicePage(pageDom) {
  const orderDateElement = getOrderDateElement(pageDom);
  const orderDateParts = orderDateElement.textContent.match(orderDateRegEx);

  if (!orderDateParts || orderDateParts.length != 3) {
    throw 'Wrong date: ' + orderDateElement.textContent;
  }
  if (orderDateParts[0].length != 4) {
    throw 'Wrong year';
  }
  if (orderDateParts[1].length != 2 && orderDateParts[1].length != 1) {
    throw 'Wrong month';
  }
  if (orderDateParts[2].length != 2 && orderDateParts[2].length != 1) {
    throw 'Wrong day';
  }

  let orderDateStr = orderDateParts[0] + '-';

  if (orderDateParts[1].length == 1) {
    orderDateStr += '0' + orderDateParts[1];
  } else {
    orderDateStr += orderDateParts[1];
  }
  orderDateStr += '-';

  if (orderDateParts[2].length == 1) {
    orderDateStr += '0' + orderDateParts[2];
  } else {
    orderDateStr += orderDateParts[2];
  }
  return orderDateStr;
}

function onClickDownloadCSV() {
  let orderDetailsColl = retrieveOrdersFromStore();
  sortOrders(orderDetailsColl);
  const csvLines = breakdownOrdersToCSVLines(orderDetailsColl);
  createDownloadFileFromData(csvLines);
}

function onClickReset() {
  let storeKeysToRemove = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const storeKey = sessionStorage.key(i);
    if (storeKey.startsWith(STORE_KEY_ORDER_PREFIX)) {
      storeKeysToRemove.push(storeKey);
    }
  }

  storeKeysToRemove.forEach(k => sessionStorage.removeItem(k));

  sessionStorage.removeItem(STORE_KEY_ORDER_COUNT);
  sessionStorage.removeItem(STORE_KEY_DATE_MIN);
  sessionStorage.removeItem(STORE_KEY_DATE_MAX);

  currPageStatus = CurrentPageStatus.DEFAULT;
  currPageOrderCount = 0;
  currPageOrderCountCancelled = 0;
  currPageItemCount = 0;

  warnMsg = '';
  statusDiv.innerHTML = getStatusText();

  console.log('clear');
}

function retrieveOrdersFromStore() {
  let jsons = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const storeKey = sessionStorage.key(i);
    if (storeKey.startsWith(STORE_KEY_ORDER_PREFIX)) {
      const orderDetailsJSON = sessionStorage.getItem(storeKey);
      jsons.push(orderDetailsJSON);
      console.log(orderDetailsJSON);
    }
  }

  let orderDetailsColl = [];
  for (let orderDetailsJSON of jsons) {
    const orderDetails = JSON.parse(orderDetailsJSON);
    orderDetailsColl.push(orderDetails);
  }

  return orderDetailsColl;
}

function sortOrders(orderDetailsColl) {
  orderDetailsColl.sort((x, y) => {
    if (x.date < y.date) return -1;
    if (x.date > y.date) return 1;
    if (x.id < y.id) return -1;
    if (x.id > y.id) return 1;
    return 0;
  })
}

function breakdownOrdersToCSVLines(orderDetailsColl) {
  let csvLines = [];
  for (let orderDetails of orderDetailsColl) {
    const orderID = orderDetails.id;
    const orderDate = orderDetails.date;
    const items =  orderDetails.items;

    for (let item of items) {
      let lineParts = [];
      lineParts.push(orderID);
      lineParts.push(orderDate);
      lineParts.push(item.name);
      lineParts.push(item.price);

      csvLines.push(lineParts.join('|') + '\n');
    }
  }
  return csvLines;
}

function createDownloadFileFromData(csvLines) {
  let downloadLink = document.createElement('a');
  const blob = new Blob(csvLines, {type: "text/plain"});
  downloadLink.href = window.URL.createObjectURL(blob);
  downloadLink.download = "orders.csv";
  downloadLink.click();
}
