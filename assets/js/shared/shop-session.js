let _shopCharId = '';

export function getShopCharId() {
  return _shopCharId;
}

export function setShopCharId(id = '') {
  _shopCharId = id || '';
}
