class AddTotalGameSecondsToRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_year_stats, :total_game_seconds, :bigint, default: 0, null: false
  end
end
