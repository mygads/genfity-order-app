/**
 * Voucher lintas layar kasir: nominal + opsional rate/cap/minSpend promo
 * percent agar totals() hitung persen end-to-end (bukan flat sebesar cap).
 */
export type NavVoucher = {
  code: string;
  amount: number;
  kind?: string;
  rate?: number;
  maxAmount?: number;
  minSpend?: number;
};

export type RootStackParamList = {
  Intro: undefined;
  Install: undefined;
  SelectBranch: undefined;
  InstallProgress: { branch?: string } | undefined;
  CreatePin: { branch?: string; userId?: string } | undefined;
  ForgotPin: undefined;
  Login: undefined;
  QrHow: undefined;
  Dashboard: undefined;
  Cashier:
    | {
        table?: string;
        mode?: string;
        customer?: string;
        tamu?: number;
        voucher?: NavVoucher;
        customItem?: { name: string; price: number; qty: number; note?: string };
        itemNote?: { id: string; note: string };
        loadItems?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[];
      }
    | undefined;
  CartDetail: { items?: unknown; total?: number; mode?: string; table?: string; ongkir?: number; customer?: string; newOrder?: unknown; kind?: string; voucher?: NavVoucher } | undefined;
  DineIn: { table?: string; mode?: string; items?: unknown; ongkir?: number; customer?: string } | undefined;
  CustomMenu: { itemId?: string; id?: string; itemName?: string; name?: string } | undefined;
  BillPreview: { items?: unknown; total?: number; subtotal?: number; discount?: number; voucher?: string | NavVoucher; voucherCode?: string; service?: number; serviceTotal?: number; tax?: number; vatTotal?: number; feeESB?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; customer?: string; memberId?: string } | undefined;
  Receipt: { no?: string; total?: number; ongkir?: number; method?: string; mode?: string; cash?: number; change?: number; table?: string; cashier?: string; customer?: string; memberId?: string; items?: unknown; discount?: number; service?: number; tax?: number; feeESB?: number; rounding?: number; voucherCode?: string; approvalCode?: string; cardLast4?: string; bank?: string; terminal?: string; shopName?: string; shopAddr?: string; footer?: string; voidLines?: { name: string; qty: number; price: number }[]; reason?: string } | undefined;
  Tables: undefined;
  Booking: undefined;
  LoadOrder: { newOrder?: { title: string; mode: string; table?: string; items?: unknown; ongkir?: number }; kind?: string } | undefined;
  Cancel: { orderId?: string; table?: string; cashier?: string; total?: number } | undefined;
  Member: { memberId?: string; nama?: string; saldoBaru?: number; topupNominal?: number; total?: number; items?: unknown; method?: string; mode?: string; table?: string; ongkir?: number; customer?: string; voucher?: string | NavVoucher | number; voucherCode?: string; discount?: number; service?: number; tax?: number; rounding?: number; feeESB?: number } | undefined;
  Voucher: undefined;
  QrScan: undefined;
  Pay: { total?: number; method?: string; voucher?: string | { code: string; amount: number; kind?: string } | number; voucherCode?: string; discount?: number; service?: number; tax?: number; feeESB?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[] } | undefined;
  Qris: { total?: number; orderNo?: string; mode?: string; table?: string; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; rounding?: number; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string } | undefined;
  Edc: { total?: number; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string } | undefined;
  Success: { total?: number; method?: string; cash?: number; change?: number; orderNo?: string; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucher?: string | { code: string; amount?: number; kind?: string }; voucherCode?: string; ongkir?: number; service?: number; tax?: number; feeESB?: number; rounding?: number; mode?: string; table?: string; customer?: string; memberId?: string; approvalCode?: string; cardLast4?: string; bank?: string; terminal?: string } | undefined;
  Attendance: undefined;
  Shift: undefined;
  Recap: undefined;
  EndShift: undefined;
  History: undefined;
  EsbOrder: undefined;
  Kitchen: undefined;
  Printers: undefined;
  Settings: undefined;
  CustomerDisplay: undefined;
  WebView: { url: string; title?: string } | undefined;
  SplitBill: { items?: unknown; total?: number } | undefined;
  MoveItems: { from?: string } | undefined;
  MoveTable: { from?: string } | undefined;
  PromotionList: { returnTo?: string; subtotal?: number; ongkir?: number; kind?: string } | undefined;
  MenuPrinting: undefined;
  Stock: undefined;
  TableTimer: undefined;
  Sync: undefined;
  Log: undefined;
  About: undefined;
  Help: undefined;
  MenuManagement: undefined;
  Idle: undefined;
  TopupDeposit: { memberId?: string; nama?: string; saldo?: number } | undefined;
  PettyCash: undefined;
  PettyCashForm: undefined;
  PettyCashDetail: { id?: string; tanggal?: string; keterangan?: string; coa?: string; arus?: string; jumlah?: number; kasir?: string; disetujui?: boolean; photo?: string } | undefined;
  Expense: undefined;
};
