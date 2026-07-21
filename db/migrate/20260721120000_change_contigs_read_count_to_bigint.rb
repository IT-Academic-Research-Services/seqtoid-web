class ChangeContigsReadCountToBigint < ActiveRecord::Migration[7.2]
  # contigs.read_count is the number of reads assembled into a single contig.
  # At scale that count can exceed the signed 32-bit int max (2,147,483,647):
  # a real contig came in at 3,828,587,663 and overflowed on insert
  # (ActiveModel::RangeError in db_load_contigs, Sentry DEV-RAILS-PROJECT-1W),
  # failing the whole contig load. Widen it to bigint.
  #
  # base_count (bases in one contig) is left as integer: it is bounded by the
  # contig length, which never approaches 2.1 billion bases.
  def up
    change_column :contigs, :read_count, :bigint
  end

  def down
    change_column :contigs, :read_count, :integer
  end
end
