# The document-IDV lane was retired (approval = attestation + Visual Compliance denied-party screening,
# with NO document-IDV; legal-approved 2026-08-24). The export_control_clearances flow no longer writes a
# verification_status. Relax the NOT NULL constraint so screening-only rows can be recorded, while
# KEEPING the column (and all historical idv_* data) intact -- this is non-destructive: no column is
# dropped and no data is touched.
class MakeExportControlVerificationStatusNullable < ActiveRecord::Migration[7.2]
  def up
    change_column_null :export_control_clearances, :verification_status, true
  end

  def down
    # Backfill any NULLs written after the IDV lane was removed to a benign historical value so the NOT
    # NULL constraint can be restored on rollback.
    execute(<<~SQL)
      UPDATE export_control_clearances
      SET verification_status = 'pending'
      WHERE verification_status IS NULL
    SQL
    change_column_null :export_control_clearances, :verification_status, false
  end
end
