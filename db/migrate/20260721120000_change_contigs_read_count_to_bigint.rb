class ChangeContigsReadCountToBigint < ActiveRecord::Migration[7.2]
  # contigs.read_count is the number of reads assembled into a single contig.
  # At scale that count can exceed the signed 32-bit int max (2,147,483,647):
  # a real contig came in at 3,828,587,663 and overflowed on insert
  # (ActiveModel::RangeError in db_load_contigs, Sentry DEV-RAILS-PROJECT-1W),
  # failing the whole contig load. Widen it to bigint.
  #
  # base_count (bases in one contig) is left as integer: it is bounded by the
  # contig length, which never approaches 2.1 billion bases.
  #
  # safety_assured: strong_migrations flags change_column (a type change can
  # rewrite the table) and aborts it at the migrate/PreSync hook -- which blocked
  # the sandbox sync and the dev deploy. int -> bigint is a reviewed, non-destructive
  # widening, so assert it. (contigs on dev/sandbox is small enough that the rebuild
  # is a non-issue; revisit with an online change if this ever runs on a big table.)
  def up
    safety_assured { change_column :contigs, :read_count, :bigint }
  end

  def down
    safety_assured { change_column :contigs, :read_count, :integer }
  end
end
