class AddExtraStatsToRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_year_stats, :extra_stats, :jsonb, default: {}
  end
end
