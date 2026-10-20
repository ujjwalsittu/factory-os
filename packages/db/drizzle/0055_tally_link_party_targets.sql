DROP INDEX "tally_link_target_uq";--> statement-breakpoint
CREATE INDEX "tally_link_target_idx" ON "tally_link" USING btree ("entity_id","kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_link_target_uq" ON "tally_link" USING btree ("entity_id","kind","target_id") WHERE "tally_link"."kind" <> 'party';