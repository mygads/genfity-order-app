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

export const transactions: Transaction[] = [
  {
    id: 'tx1',
    no: 'TRX-20261013-001',
    date: '13 Okt 2026',
    time: '12:04',
    cashier: 'Andi',
    table: 'A-01',
    mode: 'Dine In',
    items: [
      { name: 'Nasi Goreng Spesial', qty: 2, price: 25000 },
      { name: 'Es Teh Manis', qty: 2, price: 8000 },
    ],
    subtotal: 66000,
    discount: 0,
    tax: 6600,
    total: 72600,
    payment: 'Tunai',
    status: 'Selesai',
  },
  {
    id: 'tx2',
    no: 'TRX-20261013-002',
    date: '13 Okt 2026',
    time: '11:47',
    cashier: 'Andi',
    table: 'B-03',
    mode: 'Dine In',
    items: [
      { name: 'Ayam Geprek', qty: 1, price: 18000, note: 'Level 3' },
      { name: 'Jus Alpukat', qty: 1, price: 15000 },
    ],
    subtotal: 33000,
    discount: 3000,
    tax: 3000,
    total: 33000,
    payment: 'QRIS',
    status: 'Selesai',
  },
  {
    id: 'tx3',
    no: 'TRX-20261013-003',
    date: '13 Okt 2026',
    time: '11:20',
    cashier: 'Sinta',
    mode: 'Take Away',
    items: [{ name: 'Mie Goreng Jawa', qty: 3, price: 22000 }],
    subtotal: 66000,
    discount: 0,
    tax: 6600,
    total: 72600,
    payment: 'EDC',
    status: 'Selesai',
  },
  {
    id: 'tx4',
    no: 'TRX-20261013-004',
    date: '13 Okt 2026',
    time: '10:58',
    cashier: 'Sinta',
    table: 'A-05',
    mode: 'Dine In',
    items: [
      { name: 'Soto Ayam', qty: 2, price: 17000 },
      { name: 'Tempe Mendoan', qty: 1, price: 12000 },
    ],
    subtotal: 46000,
    discount: 0,
    tax: 4600,
    total: 50600,
    payment: 'Tunai',
    status: 'Void',
  },
  {
    id: 'tx5',
    no: 'TRX-20261012-031',
    date: '12 Okt 2026',
    time: '20:15',
    cashier: 'Andi',
    mode: 'Take Away',
    items: [
      { name: 'Nasi Goreng Spesial', qty: 1, price: 25000 },
      { name: 'Es Jeruk', qty: 1, price: 10000 },
    ],
    subtotal: 35000,
    discount: 0,
    tax: 3500,
    total: 38500,
    payment: 'QRIS',
    status: 'Selesai',
  },
  {
    id: 'tx6',
    no: 'TRX-20261012-030',
    date: '12 Okt 2026',
    time: '19:40',
    cashier: 'Sinta',
    table: 'C-02',
    mode: 'Dine In',
    items: [{ name: 'Paket Hemat 1', qty: 4, price: 30000 }],
    subtotal: 120000,
    discount: 12000,
    tax: 10800,
    total: 118800,
    payment: 'Tunai',
    status: 'Batal',
  },
];

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

export const esbOrders: EsbOrder[] = [
  {
    id: 'esb1',
    code: 'ESB-88121',
    customer: 'Budi Santoso',
    phone: '0812-3456-7890',
    type: 'Diantar',
    time: '12:10',
    items: [
      { name: 'Nasi Goreng Spesial', qty: 2, price: 25000 },
      { name: 'Es Teh Manis', qty: 1, price: 8000 },
    ],
    total: 58000,
    status: 'Baru',
    note: 'Es teh esnya sedikit',
  },
  {
    id: 'esb2',
    code: 'ESB-88120',
    customer: 'Rina Wulandari',
    phone: '0813-9876-5432',
    type: 'Ambil Sendiri',
    time: '11:55',
    items: [{ name: 'Ayam Geprek', qty: 3, price: 18000, note: 'Level 5' }],
    total: 54000,
    status: 'Baru',
  },
  {
    id: 'esb3',
    code: 'ESB-88119',
    customer: 'Dedi Kurniawan',
    phone: '0821-1111-2222',
    type: 'Diantar',
    time: '11:30',
    items: [
      { name: 'Mie Goreng Jawa', qty: 2, price: 22000 },
      { name: 'Jus Alpukat', qty: 2, price: 15000 },
    ],
    total: 74000,
    status: 'Diproses',
  },
  {
    id: 'esb4',
    code: 'ESB-88118',
    customer: 'Sari Melati',
    phone: '0856-7777-8888',
    type: 'Ambil Sendiri',
    time: '10:45',
    items: [{ name: 'Soto Ayam', qty: 1, price: 17000 }],
    total: 17000,
    status: 'Selesai',
  },
];

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

export const kitchenTickets: KitchenTicket[] = [
  {
    id: 'k1',
    no: 'T-014',
    table: 'A-01',
    mode: 'Dine In',
    time: '12:04',
    elapsed: '8 mnt',
    items: [
      { name: 'Nasi Goreng Spesial', qty: 2 },
      { name: 'Es Teh Manis', qty: 2, note: 'Es sedikit' },
    ],
    status: 'Baru',
    priority: true,
  },
  {
    id: 'k2',
    no: 'T-013',
    table: 'B-03',
    mode: 'Dine In',
    time: '11:47',
    elapsed: '25 mnt',
    items: [{ name: 'Ayam Geprek', qty: 1, note: 'Level 3' }],
    status: 'Diproses',
    priority: false,
  },
  {
    id: 'k3',
    no: 'T-012',
    table: 'Online',
    mode: 'ESB Order',
    time: '11:30',
    elapsed: '42 mnt',
    items: [
      { name: 'Mie Goreng Jawa', qty: 2 },
      { name: 'Jus Alpukat', qty: 2 },
    ],
    status: 'Diproses',
    priority: false,
  },
  {
    id: 'k4',
    no: 'T-011',
    table: 'A-05',
    mode: 'Dine In',
    time: '10:58',
    elapsed: '1 jam',
    items: [{ name: 'Soto Ayam', qty: 2 }],
    status: 'Selesai',
    priority: false,
  },
];

export type PrinterType = 'Bluetooth' | 'USB' | 'LAN';

export interface PrinterDevice {
  id: string;
  name: string;
  address: string;
  type: PrinterType;
  role: string;
  connected: boolean;
}

export const printers: PrinterDevice[] = [
  {
    id: 'p1',
    name: 'XPrinter XP-80C',
    address: '00:11:22:33:44:55',
    type: 'Bluetooth',
    role: 'Struk Kasir',
    connected: true,
  },
  {
    id: 'p2',
    name: 'XPrinter XP-58',
    address: '00:11:22:33:44:66',
    type: 'Bluetooth',
    role: 'Printer Dapur',
    connected: false,
  },
  {
    id: 'p3',
    name: 'EPSON TM-T82X',
    address: '192.168.1.101:9100',
    type: 'LAN',
    role: 'Struk Kasir 2',
    connected: false,
  },
];
