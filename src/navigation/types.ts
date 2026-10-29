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
  /** S4-APP-333: kode klaim pra-isi dari tab Claim QrScan (authed). */
  Install: { code?: string } | undefined;
  SelectBranch: undefined;
  /** B2 BindFlow (SPEC B1): branch → terminal → PIN, sebelum Login. */
  BranchPicker: { branchId?: string } | undefined;
  TerminalPicker: { branchId: string; branchName?: string } | undefined;
  TerminalPin: { branchId: string; branchName?: string; terminalId: string; terminalCode: string; terminalName?: string; tag?: string } | undefined;
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
  CartDetail: { items?: unknown; total?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; packaging?: number; customer?: string; newOrder?: unknown; kind?: string; voucher?: NavVoucher } | undefined;
  DineIn: { table?: string; mode?: string; items?: unknown; ongkir?: number; packaging?: number; customer?: string } | undefined;
  CustomMenu: { itemId?: string; id?: string; itemName?: string; name?: string } | undefined;
  BillPreview: { items?: unknown; total?: number; subtotal?: number; discount?: number; voucher?: string | NavVoucher; voucherCode?: string; service?: number; serviceTotal?: number; tax?: number; vatTotal?: number; feeESB?: number; packaging?: number; rounding?: number; tip?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string; orderNote?: string; deliveryAddr?: string; shopName?: string; shopAddr?: string; cashier?: string } | undefined;
  Receipt: { no?: string; total?: number; ongkir?: number; ongkirCut?: number; unpaid?: boolean; method?: string; mode?: string; cash?: number; change?: number; table?: string; cashier?: string; customer?: string; memberId?: string; memberLine?: string; items?: unknown; discount?: number; service?: number; tax?: number; tip?: number; feeESB?: number; packaging?: number; rounding?: number; voucherCode?: string; approvalCode?: string; cardLast4?: string; bank?: string; terminal?: string; shopName?: string; shopAddr?: string; shopPhone?: string; shopEmail?: string; orderNote?: string; deliveryAddr?: string; footer?: string; clientId?: string; autoPrint?: boolean; splitPaid?: { amount?: number; method?: string }; voidLines?: { name: string; qty: number; price: number }[]; reason?: string; voided?: boolean } | undefined;
  Tables: undefined;
  Booking: undefined;
  LoadOrder: { newOrder?: { title: string; mode: string; table?: string; items?: unknown; ongkir?: number }; kind?: string } | undefined;
  Cancel: { orderId?: string; table?: string; cashier?: string; total?: number } | undefined;
  Member: { memberId?: string; nama?: string; saldoBaru?: number; topupNominal?: number; total?: number; items?: unknown; method?: string; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; voucher?: string | NavVoucher | number; voucherCode?: string; discount?: number; service?: number; tax?: number; rounding?: number; feeESB?: number; packaging?: number } | undefined;
  Voucher: undefined;
  QrScan: undefined;
  Pay: { total?: number; method?: string; voucher?: string | NavVoucher | number; voucherCode?: string; discount?: number; service?: number; tax?: number; feeESB?: number; packaging?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; salesNum?: string; clientId?: string; splits?: { method?: string; amount?: number }[]; splitGroup?: boolean; orderTotal?: number } | undefined;
  Qris: { total?: number; orderNo?: string; salesNum?: string; clientId?: string; splits?: { method?: string; amount?: number }[]; splitGroup?: boolean; orderTotal?: number; mode?: string; table?: string; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; packaging?: number; rounding?: number; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string } | undefined;
  Edc: { total?: number; salesNum?: string; clientId?: string; splits?: { method?: string; amount?: number }[]; splitGroup?: boolean; orderTotal?: number; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; packaging?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; customer?: string; memberId?: string } | undefined;
  Success: { total?: number; method?: string; cash?: number; change?: number; orderNo?: string; clientId?: string; splitPaid?: { amount?: number; method?: string }; items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[]; discount?: number; voucher?: string | NavVoucher; voucherCode?: string; ongkir?: number; ongkirCut?: number; service?: number; tax?: number; feeESB?: number; packaging?: number; rounding?: number; mode?: string; table?: string; customer?: string; memberId?: string; approvalCode?: string; cardLast4?: string; bank?: string; terminal?: string } | undefined;
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
  /** B2 QueueView (tag view_queue): papan antrean branch-scoped terkunci. */
  QueueView: undefined;
  WebView: { url: string; title?: string } | undefined;
  SplitBill: { items?: unknown; total?: number } | undefined;
  MoveItems: { from?: string } | undefined;
  MoveTable: { from?: string } | undefined;
  PromotionList: { returnTo?: string; subtotal?: number; ongkir?: number; kind?: string; items?: unknown; mode?: string; table?: string; customer?: string; memberId?: string; salesNum?: string } | undefined;
  MenuPrinting: undefined;
  Stock: undefined;
  TableTimer: undefined;
  Sync: undefined;
  Log: undefined;
  About: undefined;
  Help: undefined;
  /** Cermin FE /admin/dashboard/menu/stock: kelola stok + tandai habis
      per menu dan per addon/varian. */
  StockManagement: undefined;
  Idle: undefined;
  TopupDeposit: { memberId?: string; nama?: string; saldo?: number } | undefined;
  PettyCash: undefined;
  PettyCashForm: undefined;
  PettyCashDetail: { id?: string; tanggal?: string; keterangan?: string; coa?: string; arus?: string; jumlah?: number; kasir?: string; disetujui?: boolean; photo?: string } | undefined;
  Expense: undefined;
};
