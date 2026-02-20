class AddKdaToRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_year_stats, :total_kills, :bigint, default: 0, null: false
    add_column :recap_year_stats, :total_deaths, :bigint, default: 0, null: false
    add_column :recap_year_stats, :total_assists, :bigint, default: 0, null: false
  end
end
