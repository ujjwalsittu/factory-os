import { FaiController } from './modules/quality/fai.controller.js';
import { FaiService } from './modules/quality/fai.service.js';
import { QualityController } from './modules/quality/quality.controller.js';
import { QualityService } from './modules/quality/quality.service.js';
import { AttachmentsController } from './modules/storage/attachments.controller.js';
import { StorageService } from './modules/storage/storage.service.js';
import { SupportAccessController, SupportOperatorController } from './modules/support-access/support-access.controller.js';
import { SupportProofService } from './modules/support-access/support-access.proof.js';
import { SupportAccessStore } from './modules/support-access/support-access.store.js';
import { SupportReadService } from './modules/support-access/support-access.read.js';
import { SupportReadPoolService } from './modules/support-access/support-access.read-pool.js';
import { SupportWorkspaceController } from './modules/support-access/support-access.workspace.controller.js';
import { StorageSettingsService } from './modules/storage/storage-settings.service.js';
import { PlatformStorageController } from './modules/storage/storage-settings.controller.js';
import { Itc04Controller } from './modules/manufacturing/itc04.controller.js';
import { JobWorkController } from './modules/manufacturing/job-work.controller.js';
import { JobWorkService } from './modules/manufacturing/job-work.service.js';
import { GenealogyController } from './modules/manufacturing/genealogy.controller.js';
import { GenealogyService } from './modules/manufacturing/genealogy.service.js';
import { ManufacturingMastersController } from './modules/manufacturing/masters.controller.js';
import { CalendarController } from './modules/manufacturing/calendar.controller.js';
import { SchedulingController } from './modules/manufacturing/scheduling.controller.js';
import { SchedulingService } from './modules/manufacturing/scheduling.service.js';
import { WorkOrdersController } from './modules/manufacturing/work-orders.controller.js';
import { WorkOrderService } from './modules/manufacturing/work-order.service.js';
import {SsoService} from './modules/sso/sso.service.js';
import {SsoController} from './modules/sso/sso.controller.js';
import {PasskeysService} from './modules/passkeys/passkeys.service.js';
import {PasskeysController} from './modules/passkeys/passkeys.controller.js';
import {EmailService} from './modules/email/email.service.js';
import {EmailController,PlatformEmailController} from './modules/email/email.controller.js';
import { BankReportService } from './modules/bank-reconciliation/report.service.js';
import { BankAdjustmentService } from './modules/bank-reconciliation/adjustment.service.js';
import { BankMatchService } from './modules/bank-reconciliation/match.service.js';
import { BankImportService } from './modules/bank-reconciliation/import.service.js';
import { BankReconciliationController } from './modules/bank-reconciliation/bank-reconciliation.controller.js';
import { BankRegistryService } from './modules/bank-reconciliation/registry.service.js';
import { BankReconciliationGuard } from './modules/accounting/bank-reconciliation-guard.service.js';
import { BankChargesController } from './modules/accounting/bank-charges.controller.js';
import { BankChargeService } from './modules/accounting/bank-charge.service.js';
import { WithholdingController } from './modules/withholding/withholding.controller.js';
import { TaxPolicyService } from './modules/withholding/policy.service.js';
import {GstSandboxController,SandboxConnectionsService,SandboxOperationsService,SandboxSourceService} from './modules/gst-sandbox/module.js';
import {SupplierReturnResolutionService} from './modules/supplier-returns/resolution.service.js';
import {SupplierCreditApplicationService} from './modules/supplier-returns/credit-application.service.js';
import {SupplierNotePostingService} from './modules/supplier-returns/note-posting.service.js';
import {SupplierNotePreviewService} from './modules/supplier-returns/preview.service.js';
import {SupplierNoteService} from './modules/supplier-returns/note.service.js';
import {SupplierReturnMovementService} from './modules/supplier-returns/movement.service.js';
import { SupplierReturnPolicyService } from './modules/supplier-returns/policy.service.js';
import { SupplierReturnClaimService } from './modules/supplier-returns/claim.service.js';
import { SupplierReturnsController } from './modules/supplier-returns/supplier-returns.controller.js';
import { SalesNoteService } from './modules/sales-notes/sales-note.service.js';
import { SalesReturnService } from './modules/sales-notes/sales-return.service.js';
import { CreditApplicationService } from './modules/sales-notes/credit-application.service.js';
import { SalesNotePostingService } from './modules/sales-notes/sales-note-posting.service.js';
import { SalesNotePreviewService } from './modules/sales-notes/sales-note-preview.service.js';
import { SalesNotesController } from './modules/sales-notes/sales-notes.controller.js';
import { AccountingReportsController } from './modules/accounting/reports.controller.js';
import { OperationalPostings } from './modules/accounting/operational-postings.js';
import { ReceiptAllocationService } from './modules/accounting/receipt-allocation.service.js';
import { AcquisitionCostService } from './modules/accounting/acquisition-cost.service.js';
import { AccountingController } from './modules/accounting/accounting.controller.js';
import { GlPostingService } from './modules/accounting/gl-posting.service.js';
import { InvoiceBalancesController } from './modules/accounting/invoice-balances.controller.js';
import { BillService } from './modules/accounting/bill.service.js';
import { SettlementService } from './modules/accounting/settlement.service.js';
import { SettlementsController } from './modules/accounting/settlements.controller.js';
import { OpeningService } from './modules/accounting/opening.service.js';
import { createDb, type Database } from '@factoryos/db';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createAuth } from './auth.js';
import { AccessGuard } from './common/access.js';
import { AuditService } from './common/audit.service.js';
import { AUTH, CONFIG, DB } from './common/tokens.js';
import { type AppConfig, loadConfig } from './config.js';
import { EntitiesController } from './modules/entities.controller.js';
import { HealthController } from './modules/health.controller.js';
import { InventoryController } from './modules/inventory.controller.js';
import { MastersController } from './modules/masters.controller.js';
import { StockPostingService } from './modules/stock-posting.service.js';
import { MeController } from './modules/me.controller.js';
import { ApprovalsController } from './modules/approvals.controller.js';
import { HomeController } from './modules/home.controller.js';
import { RecordsController } from './modules/records.controller.js';
import { TallyBooksController, TallyController, TallyDocumentsController, TallyHistoryController, TallyMappingsController } from './modules/tally/tally.controller.js';
import { ConnectionsController } from './modules/connections/connections.controller.js';
import { TallyService } from './modules/tally/tally.service.js';
import { GstReturnsController } from './modules/gst-returns/gst-returns.controller.js';
import { GstReturnsService } from './modules/gst-returns/gst-returns.service.js';
import { PreferencesController } from './modules/preferences.controller.js';
import { MembersController } from './modules/members.controller.js';
import { PlatformController } from './modules/platform.controller.js';
import { RolesController } from './modules/roles.controller.js';
import { TenancyService } from './modules/tenancy.service.js';
import { BuyingController } from './modules/buying.controller.js';
import { LandedCostController } from './modules/landed-cost.controller.js';
import { SellingController } from './modules/selling.controller.js';
import { MaasController } from './modules/services/maas.controller.js';
import { MembershipsController } from './modules/services/memberships.controller.js';
import { CampaignsController } from './modules/services/campaigns.controller.js';
import { ProjectsController } from './modules/services/projects.controller.js';
import { TimesheetsController } from './modules/services/timesheets.controller.js';
import { SubscriptionsController } from './modules/services/subscriptions.controller.js';
import { BillingRunsController } from './modules/services/billing-runs.controller.js';
import { CapaController } from './modules/quality/capa.controller.js';
import { SkillsController } from './modules/quality/skills.controller.js';
import { SkillsService } from './modules/quality/skills.service.js';
import { IngestController, PlantController } from './modules/iot/iot.controller.js';
import { IotService } from './modules/iot/iot.service.js';
import { LabelService } from './modules/iot/labels.service.js';
import { PrintersController } from './modules/iot/printers.controller.js';
import { SmtController } from './modules/manufacturing/smt.controller.js';
import { SmtService } from './modules/manufacturing/smt.service.js';
import { MaintenanceController } from './modules/maintenance/maintenance.controller.js';
import { MaintenanceService } from './modules/maintenance/maintenance.service.js';
import { SeriesController } from './modules/series.controller.js';
import { WasteController } from './modules/waste.controller.js';

@Module({
  controllers: [GstReturnsController,MaintenanceController,SmtController,PrintersController,MaasController,MembershipsController,CampaignsController,ProjectsController,TimesheetsController,SubscriptionsController,BillingRunsController,CapaController,SkillsController,PlantController,IngestController,SupportAccessController,SupportOperatorController,SupportWorkspaceController,PlatformStorageController,CalendarController,SchedulingController,FaiController,QualityController,AttachmentsController,Itc04Controller,JobWorkController,GenealogyController,ManufacturingMastersController,WorkOrdersController,SsoController,PasskeysController,EmailController,PlatformEmailController,BankReconciliationController,BankChargesController,WithholdingController,GstSandboxController,SupplierReturnsController,SalesNotesController,InvoiceBalancesController, AccountingReportsController, AccountingController, SettlementsController, HealthController, MeController, PreferencesController, HomeController, ApprovalsController, RecordsController, TallyController, TallyHistoryController, TallyBooksController, TallyMappingsController,TallyDocumentsController, ConnectionsController, EntitiesController, MembersController, RolesController, PlatformController, MastersController, InventoryController, WasteController, BuyingController, LandedCostController, SellingController, SeriesController],
  providers: [TallyService,GstReturnsService,MaintenanceService,SmtService,LabelService,IotService,SkillsService,SellingController,MaasController,CampaignsController,ProjectsController,SubscriptionsController,SupportAccessStore,SupportProofService,SupportReadService,SupportReadPoolService,StorageSettingsService,SchedulingService,FaiService,QualityService,StorageService,JobWorkService,GenealogyService,WorkOrderService,SsoService,PasskeysService,EmailService,BankReportService,BankAdjustmentService,BankMatchService,BankImportService,BankRegistryService,BankReconciliationGuard,BankChargeService,TaxPolicyService,SandboxConnectionsService,SandboxOperationsService,SandboxSourceService,SupplierReturnResolutionService,SupplierNoteService,SupplierNotePreviewService,SupplierNotePostingService,SupplierCreditApplicationService,SupplierReturnMovementService,SupplierReturnPolicyService,SupplierReturnClaimService,SalesNoteService, SalesReturnService, CreditApplicationService, SalesNotePostingService, SalesNotePreviewService,
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.DATABASE_URL) },
    { provide: AUTH, inject: [DB, CONFIG,EmailService], useFactory: (db: Database, c: AppConfig,email:EmailService) => createAuth(db, c,email) },
    { provide: APP_GUARD, useClass: AccessGuard },
    AuditService,
    TenancyService,
    StockPostingService,
    BillService,
    SettlementService,
    GlPostingService,
    OpeningService,
    OperationalPostings,
    ReceiptAllocationService,
    AcquisitionCostService,
  ],
})
export class AppModule {}
