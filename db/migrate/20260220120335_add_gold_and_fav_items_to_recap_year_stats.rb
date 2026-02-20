class AddGoldAndFavItemsToRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_year_stats, :total_gold_spent, :bigint, default: 0, null: false
    add_column :recap_year_stats, :fav_items, :jsonb, default: []
  end
end
