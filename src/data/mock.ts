export interface TxnItem {
  name: string;
  qty: number;
  price: number;
  note?: string;
}

export type TxnStatus = 'Selesai' | 'Void' | 'Batal';

export interface Transaction {
  id: string;
  no: string;
  date: string;
  time: string;
  cashier: string;
  table?: string;
  mode: string;
  items: TxnItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment: string;
  status: TxnStatus;
}

export const transactions: Transaction[] = [];

export type EsbStatus = 'Baru' | 'Diproses' | 'Selesai';

export interface EsbOrder {
  id: string;
  code: string;
  customer: string;
  phone: string;
  type: string;
  time: string;
  items: TxnItem[];
  total: number;
  status: EsbStatus;
  note?: string;
}

export const esbOrders: EsbOrder[] = [];

export type KitchenStatus = 'Baru' | 'Diproses' | 'Selesai';

export interface KitchenItem {
  name: string;
  qty: number;
  note?: string;
}

export interface KitchenTicket {
  id: string;
  no: string;
  table: string;
  mode: string;
  time: string;
  elapsed: string;
  items: KitchenItem[];
  status: KitchenStatus;
  priority: boolean;
}

export const kitchenTickets: KitchenTicket[] = [];

export type PrinterType = 'Bluetooth' | 'USB' | 'LAN';

export interface PrinterDevice {
  id: string;
  name: string;
  address: string;
  type: PrinterType;
  role: string;
  connected: boolean;
}

export const printers: PrinterDevice[] = [];
